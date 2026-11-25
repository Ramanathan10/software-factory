import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute } from 'node:path';
import { documentTypes, mediaTypes } from './media.mjs';
import { harnessKey, phases, roles } from './roles.mjs';

export const workerPhases = new Set(['scout', 'planning', 'testing', 'red', 'building', 'gates', 'mutation', 'review', 'comparison', 'diagram', 'ci', 'retro', 'pr-review']);
const transitions = {
  scout: 'planning',
  testing: 'red',
  red: 'building',
  building: 'gates',
  gates: 'mutation',
  mutation: 'review',
  review: 'comparison-choice',
  comparison: 'publishing',
};
const wakes = new Set([
  'create', 'question', 'answer', 'plan', 'approve', 'plan-feedback', 'handoff', 'return-to-build',
  'comparison-choice', 'replan', 'return-to-testing', 'retro-start', 'blocked', 'resume', 'assign-worktree', 'release-worker', 'select-harness',
  'pr-opened', 'pr-ready', 'pr-recheck', 'merged',
  'request-cleanup', 'cleanup-blocked',
  'diagram-start', 'pr-review-start',
]);

export class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function requireThat(condition, message, status) {
  if (!condition) throw new InputError(message, status);
}

function string(value, field, max = 4000) {
  requireThat(typeof value === 'string' && value.trim() && value.length <= max, field + ' is required and must fit within ' + max + ' characters.');
  return value.trim();
}

function identifier(value, field) {
  requireThat(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value), 'Invalid ' + field + '.');
  return value;
}

function samePhase(story, phase) {
  requireThat(story.phase === phase, 'Expected phase ' + phase + ', found ' + story.phase + '.', 409);
}

function addQuestion(story, input) {
  requireThat(story.phase !== 'closed', 'The story is closed.', 409);
  const id = identifier(input.question, 'question ID');
  requireThat(!story.questions.some(question => question.id === id), 'Question ID already exists.', 409);
  requireThat(Array.isArray(input.options) && input.options.length >= 2 && input.options.length <= 3, 'Provide two or three options.');
  const options = input.options.map(option => string(option, 'option', 300));
  requireThat(new Set(options).size === options.length, 'Options must be distinct.');
  requireThat(Number.isInteger(input.recommended) && options[input.recommended], 'Provide the recommended option index.');
  story.questions.push({ id, prompt: string(input.prompt, 'prompt'), options, recommended: input.recommended });
  return input.prompt;
}

function answerQuestion(story, input) {
  requireThat(story.phase !== 'closed', 'The story is closed.', 409);
  const question = story.questions.find(question => question.id === input.question);
  requireThat(question && !question.answer, 'Question is unavailable or already answered.', 409);
  if (typeof input.answer === 'number') {
    requireThat(Number.isInteger(input.answer) && question.options[input.answer], 'Invalid answer option.');
    question.answer = question.options[input.answer];
  } else {
    question.answer = string(input.answer, 'custom answer');
  }
  return question.answer;
}

function validHead(head) {
  return typeof head === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head);
}

const itemKinds = ['thread', 'review', 'comment'];
const short = (value, max) => typeof value === 'string' && value.length <= max;
const count = value => Number.isSafeInteger(value) && value >= 0;
const names = value => Array.isArray(value) && value.length <= 100 && value.every(name => short(name, 100));

function reviewOf(review) {
  if (review === undefined) return undefined;
  requireThat(review && typeof review === 'object' && names(review.approvals) && names(review.changesRequested) &&
    count(review.unresolved) && count(review.earlier) && typeof review.more === 'boolean' &&
    (review.lastActivityAt === undefined || short(review.lastActivityAt, 40)) &&
    Array.isArray(review.keys) && review.keys.length <= 1000 && review.keys.every(key => short(key, 200)) &&
    Array.isArray(review.items) && review.items.length <= 10 && review.items.every(item => item && short(item.key, 200) &&
      itemKinds.includes(item.kind) && short(item.author, 100) && typeof item.bot === 'boolean' && short(item.excerpt, 200) &&
      short(item.url, 500) && (item.path === undefined || short(item.path, 500)) && (item.line === undefined || count(item.line))),
  'Supply valid review evidence.');
  return {
    approvals: review.approvals, changesRequested: review.changesRequested, unresolved: review.unresolved, earlier: review.earlier,
    items: review.items.map(({ key, kind, author, bot, path, line, excerpt, url }) => ({ key, kind, author, bot, path, line, excerpt, url })),
    keys: review.keys, more: review.more, lastActivityAt: review.lastActivityAt,
  };
}

function observePr(story, input, now) {
  requireThat(['ci', 'merge', 'pr-review'].includes(story.phase) && story.pr && input.url === story.pr,
    'The registered PR is no longer being watched.', 409);
  const observation = input.observation;
  requireThat(validHead(observation?.head), 'Supply the observed PR head.');
  const { head, status, failedCount, failures } = observation;
  requireThat(['failed', 'passed', 'running', 'no-checks', 'merged', 'closed'].includes(status) &&
    Number.isSafeInteger(failedCount) && failedCount >= 0 && Array.isArray(failures) &&
    failures.length <= Math.min(10, failedCount) && failures.every(name => typeof name === 'string' && name.length <= 160),
  'Supply valid check evidence.');
  const current = { head, status, failedCount: status === 'failed' ? failedCount : 0, failures: status === 'failed' ? failures : [] };
  const review = reviewOf(observation.review);
  const previous = story.prObservation;
  const checksSame = previous && Object.keys(current).every(key => JSON.stringify(current[key]) === JSON.stringify(previous[key]));
  if (checksSame && JSON.stringify(review) === JSON.stringify(previous.review)) return null;
  const priorHead = previous?.head ?? story.readyHead;
  const newHead = Boolean(priorHead && priorHead !== current.head);
  const reconcileReady = story.phase === 'merge' && !previous && !story.readyHead;
  const labels = {
    failed: 'CI failed', passed: 'Reported checks passed', running: 'Checks still running',
    'no-checks': 'No checks reported', merged: 'Merge observed', closed: 'PR closed without merge',
  };
  const listed = current.failures.length ? ' · ' + current.failures.join(', ') : '';
  const seen = new Set(story.prSeen ?? []);
  const fresh = review ? review.keys.filter(key => !seen.has(key)) : [];
  const feedback = fresh.length > 0 && story.phase !== 'pr-review';
  const said = feedback ? ' · New feedback · ' + fresh.length + (fresh.length === 1 ? ' item' : ' items') : '';
  const detail = 'Hawkeye · ' + (newHead ? 'New head · ' : '') + labels[status] + ' · ' + head.slice(0, 12) + listed + said;
  story.prObservation = { ...current, ...(review ? { review } : {}), at: now };
  if (fresh.length) story.prSeen = [...seen, ...fresh].slice(-1000);
  const checks = !checksSame && (newHead || reconcileReady || ['failed', 'passed', 'merged', 'closed'].includes(status) ||
    Boolean(previous && ['failed', 'passed', 'closed'].includes(previous.status)));
  return { detail, feedback, wake: checks || feedback };
}

const jarvisTurnEvents = ['jarvis-woken', 'jarvis-turn-started', 'jarvis-turn-ended'];
const jarvisNotice = input => input.type === 'question' && typeof input.question === 'string' && input.question.startsWith('action-jarvis-');

function apply(story, input, now) {
  requireThat(story.harness || ['select-harness', 'release-worker'].includes(input.type), 'Select the story harness first.', 409);
  requireThat(!story.blocked || jarvisNotice(input) || ['resume', 'answer', 'replan', 'assign-worktree', 'release-worker', 'select-harness', 'merged', 'turn-started', 'turn-ended', ...jarvisTurnEvents].includes(input.type),
    'Resume or replan the blocked story first.', 409);
  switch (input.type) {
    case 'select-harness':
      requireThat(!story.harness && !story.worker && story.phase !== 'closed',
        'Select a harness only for an older open story without one or an assigned worker.', 409);
      story.harness = string(input.harness, 'harness', 100);
      return 'Story harness selected · ' + story.harness;
    case 'question':
      return addQuestion(story, input);
    case 'answer':
      return answerQuestion(story, input);
    case 'draft-plan':
      samePhase(story, 'planning');
      requireThat(input.assignment === story.worker?.id, 'Report from the current assignment.', 409);
      story.draftPlan = { text: string(input.detail, 'working plan', 16000), at: now,
        answers: story.questions.filter(question => question.answer).length };
      story.activity = { at: now, role: 'planner' };
      return 'Captain America updated the working plan.';
    case 'plan':
      samePhase(story, 'planning');
      requireThat(story.questions.every(question => question.answer), 'The plan still has open questions.', 409);
      story.plan = string(input.detail, 'plan', 16000);
      delete story.draftPlan;
      delete story.feedback;
      story.phase = 'approval';
      return 'Planner submitted the plan for approval.';
    case 'approve':
      samePhase(story, 'approval');
      story.phase = 'testing';
      return 'Plan approved.';
    case 'plan-feedback': {
      samePhase(story, 'approval');
      const comments = input.comments ?? [];
      requireThat(Array.isArray(comments) && comments.length <= 50, 'Send at most 50 plan comments.');
      const parsed = comments.map(item => ({
        quote: string(item?.quote, 'commented plan text', 2000),
        comment: string(item?.comment, 'plan comment', 4000),
      }));
      const note = input.note === undefined || input.note === '' ? undefined : string(input.note, 'plan feedback', 8000);
      requireThat(parsed.length || note, 'Add a comment or a note before requesting changes.');
      story.feedback = { comments: parsed, note, at: now };
      story.draftPlan = { text: story.plan, at: now, answers: story.questions.filter(question => question.answer).length };
      delete story.plan;
      story.phase = 'planning';
      return ['the owner requested plan changes.', note,
        ...parsed.map((item, n) => (n + 1) + '. On "' + item.quote.replace(/\s+/g, ' ').slice(0, 300) + '": ' + item.comment)]
        .filter(Boolean).join('\n');
    }
    case 'activity':
      requireThat(workerPhases.has(story.phase) || ['publishing', 'merge'].includes(story.phase), 'This phase has no reporting worker.', 409);
      requireThat(input.assignment === story.worker?.id, 'Report from the current assignment.', 409);
      if (input.file !== undefined) {
        const path = string(input.file, 'file', 1000);
        const change = string(input.change, 'change summary', 300);
        const diff = input.diff === undefined ? '' : string(input.diff, 'diff', 3000);
        const previous = story.files.findIndex(file => file.path === path);
        const file = { path, change, diff, at: now };
        if (previous >= 0) story.files[previous] = file;
        else story.files.push(file);
      }
      if (input.posted !== undefined) {
        requireThat(Array.isArray(input.posted) && input.posted.length <= 500 && input.posted.every(id => short(id, 200) && id.trim()),
          'List at most 500 posted comment IDs.');
        story.prPosted = [...new Set([...(story.prPosted ?? []), ...input.posted])].slice(-500);
      }
      if (input.pipeline !== undefined) {
        const parsed = URL.parse(string(input.pipeline, 'pipeline run URL', 500));
        requireThat(parsed?.protocol === 'https:', 'Use an https pipeline run URL.');
        story.pipeline = parsed.href;
      }
      story.activity = { at: now, role: phases[story.phase][0] };
      return string(input.detail, 'activity');
    case 'artifact': {
      requireThat(input.assignment === story.worker?.id, 'Report from the current assignment.', 409);
      requireThat(['before', 'after', 'diagram', 'recording', 'document'].includes(input.kind), 'Choose an evidence kind.');
      const path = string(input.path, 'evidence path', 2000);
      requireThat(isAbsolute(path), 'Use an absolute evidence file path.');
      let realPath;
      let stat;
      try {
        realPath = realpathSync(path);
        stat = statSync(realPath);
      } catch {
        throw new InputError('The evidence file is unavailable.');
      }
      const document = input.kind === 'document';
      requireThat(stat.isFile() && stat.size > 0 && (document ? stat.size <= 1048576 && documentTypes[extname(realPath).toLowerCase()]
        : mediaTypes[extname(realPath).toLowerCase()]),
        document ? 'Register a nonempty Markdown, JSON, or text file up to 1 MiB.' : 'Register a nonempty PNG, JPEG, WebP, MP4, or WebM file.');
      const artifact = { id: input.key, kind: input.kind, caption: string(input.detail, 'evidence caption', 1000),
        path: realPath, size: stat.size, mtimeMs: stat.mtimeMs, at: now };
      story.artifacts ??= [];
      story.artifacts.push(artifact);
      return 'Evidence added · ' + artifact.caption;
    }
    case 'assign-worker':
      requireThat(workerPhases.has(story.phase), 'This phase has no assignable worker.', 409);
      requireThat(!story.worker, 'Release the previous worker before assigning another.', 409);
      requireThat(input.host === undefined || input.host === story.harness, 'Use the harness selected for this story.', 409);
      story.worker = {
        id: input.key,
        role: phases[story.phase][0],
        session: string(input.session, 'session reference', 400),
      };
      delete story.activity;
      return roles[story.worker.role].job + ' assigned.';
    case 'release-worker':
      requireThat(story.worker && story.worker.id === input.assignment, 'Current assignment does not match.', 409);
      delete story.worker;
      delete story.activity;
      return string(input.detail, 'release evidence');
    case 'turn-started':
      requireThat(story.worker && story.worker.id === input.assignment, 'Current assignment does not match.', 409);
      requireThat(Number.isSafeInteger(input.pid) && input.pid > 0, 'Supply the process ID of the turn.');
      story.worker.turn = { pid: input.pid, log: string(input.log, 'turn log', 1000), at: now };
      return 'Worker turn started.';
    case 'turn-ended':
      requireThat(story.worker && story.worker.id === input.assignment, 'Current assignment does not match.', 409);
      requireThat(story.worker.turn, 'No turn is running.', 409);
      requireThat(['ended', 'failed', 'lost'].includes(input.outcome), 'Supply how the turn ended.');
      requireThat(input.code === undefined || input.code === null || Number.isSafeInteger(input.code), 'Invalid exit code.');
      delete story.worker.turn;
      story.worker.lastTurn = { outcome: input.outcome, at: now, ...(Number.isSafeInteger(input.code) ? { code: input.code } : {}) };
      return string(input.detail, 'turn outcome');
    case 'jarvis-woken':
      requireThat(!story.jarvis?.turn && !story.jarvis?.waking, 'Jarvis is already checking this story.', 409);
      requireThat(Number.isSafeInteger(input.handled) && input.handled >= 0, 'Supply the highest news seq handed to Jarvis.');
      story.jarvis = { ...story.jarvis, handled: input.handled, waking: now };
      return 'Jarvis woken for news up to event ' + input.handled + '.';
    case 'jarvis-turn-started':
      requireThat(!story.jarvis?.turn, 'A Jarvis turn is already running.', 409);
      requireThat(Number.isSafeInteger(input.pid) && input.pid > 0, 'Supply the process ID of the turn.');
      story.jarvis = { ...story.jarvis, session: string(input.session, 'session reference', 400),
        turn: { pid: input.pid, log: string(input.log, 'turn log', 1000), at: now } };
      delete story.jarvis.waking;
      return 'Jarvis turn started.';
    case 'jarvis-turn-ended':
      requireThat(story.jarvis?.turn || story.jarvis?.waking, 'No Jarvis turn is running.', 409);
      requireThat(['ended', 'failed', 'lost'].includes(input.outcome), 'Supply how the turn ended.');
      requireThat(input.code === undefined || input.code === null || Number.isSafeInteger(input.code), 'Invalid exit code.');
      delete story.jarvis.turn;
      delete story.jarvis.waking;
      story.jarvis.lastTurn = { outcome: input.outcome, at: now, ...(Number.isSafeInteger(input.code) ? { code: input.code } : {}) };
      return string(input.detail, 'turn outcome');
    case 'handoff':
      if (story.phase === 'diagram') {
        requireThat(['publishing', 'ci', 'merge'].includes(story.diagram?.returnPhase), 'Diagram return phase is unavailable.', 409);
        const evidence = string(input.detail, 'diagram evidence');
        story.phase = story.diagram.returnPhase;
        story.diagram.completedAt = now;
        story.diagram.detail = evidence;
        return evidence;
      }
      if (story.phase === 'pr-review') {
        const outcome = string(input.detail, 'PR review outcome');
        story.phase = story.prReview?.returnPhase ?? 'ci';
        story.prReview = { ...story.prReview, completedAt: now, detail: outcome };
        return outcome;
      }
      if (story.phase === 'retro') {
        requireThat(['ci', 'merge'].includes(story.retro?.returnPhase), 'Retro return phase is unavailable.', 409);
        const lessons = string(input.detail, 'retro lessons');
        story.phase = story.retro.returnPhase;
        story.retro.completedAt = now;
        story.retro.detail = lessons;
        return lessons;
      }
      requireThat(transitions[story.phase], 'This phase has no handoff.', 409);
      if (['red', 'building', 'gates', 'mutation'].includes(story.phase)) string(input.command, 'verification command');
      story.phase = transitions[story.phase];
      return string(input.detail, 'handoff evidence');
    case 'diagram-start':
      requireThat(['review', 'comparison', 'publishing', 'ci', 'merge'].includes(story.phase), 'Start diagram work after review.', 409);
      story.diagram = { returnPhase: ['review', 'comparison'].includes(story.phase) ? 'publishing' : story.phase, startedAt: now, detail: string(input.detail, 'diagram scope') };
      story.phase = 'diagram';
      return 'Rocket started architecture diagram work.';
    case 'retro-start':
      requireThat(['ci', 'merge'].includes(story.phase), 'Start the retro while the pull request is open.', 409);
      story.retro = { returnPhase: story.phase, startedAt: now, detail: string(input.detail, 'retro scope') };
      story.phase = 'retro';
      return 'Retro started.';
    case 'pr-review-start':
      requireThat(['ci', 'merge'].includes(story.phase) && story.pr, 'Start PR review while the pull request is open.', 409);
      story.prReview = { returnPhase: 'ci', startedAt: now, detail: string(input.detail, 'review feedback') };
      delete story.readyHead;
      story.phase = 'pr-review';
      return 'Hawkeye started PR review · ' + story.prReview.detail;
    case 'return-to-build':
      requireThat(['review', 'gates', 'comparison', 'pr-review'].includes(story.phase), 'Return to build from review, the deterministic gates, the comparison, or PR review.', 409);
      if (story.phase === 'review') story.reviewRounds = (story.reviewRounds ?? 0) + 1;
      story.phase = 'building';
      return string(input.detail, 'review finding');
    case 'return-to-testing':
      samePhase(story, 'mutation');
      story.phase = 'testing';
      return string(input.detail, 'surviving mutants');
    case 'replan':
      requireThat(story.phase !== 'planning' && story.phase !== 'closed',
        'This phase cannot reopen planning.', 409);
      story.phase = 'planning';
      delete story.blocked;
      delete story.readyHead;
      delete story.draftPlan;
      delete story.diagram;
      delete story.retro;
      delete story.prReview;
      delete story.comparisonRequested;
      return string(input.detail, 'unresolved decision');
    case 'assign-worktree': {
      requireThat(story.phase !== 'closed', 'The story is closed.', 409);
      requireThat(!story.worker, 'Release the worker before changing its worktree.', 409);
      const branch = string(input.branch, 'branch', 200);
      requireThat(!story.pr || branch === story.branch, 'Keep the existing PR branch when reassigning its worktree.', 409);
      story.branch = branch;
      story.worktree = string(input.worktree, 'worktree', 1000);
      delete story.activity;
      return 'Worktree assigned · ' + story.worktree + ' / ' + story.branch;
    }
    case 'blocked':
      requireThat(story.phase !== 'closed', 'The story is closed.', 409);
      story.blocked = string(input.detail, 'blocker');
      delete story.activity;
      return story.blocked;
    case 'resume':
      requireThat(story.blocked, 'The story is not blocked.', 409);
      delete story.blocked;
      return string(input.detail, 'resolution');
    case 'comparison-choice':
      samePhase(story, 'comparison-choice');
      requireThat(typeof input.run === 'boolean', 'Choose whether to run before-and-after.');
      story.comparisonRequested = input.run;
      story.phase = input.run ? 'comparison' : 'publishing';
      return input.run ? 'Before-and-after requested.' : 'Before-and-after declined.';
    case 'pr-opened':
      samePhase(story, 'publishing');
      {
        const url = string(input.url, 'pull request URL', 500);
        const parsed = URL.parse(url);
        requireThat(parsed?.protocol === 'https:' && parsed.pathname.length > 1 && !parsed.username && !parsed.password,
          'Use a complete HTTPS pull request URL.');
        requireThat(!story.pr || story.pr === parsed.href, 'Continue on the existing pull request.', 409);
        story.pr = parsed.href;
      }
      story.phase = 'ci';
      return story.pr;
    case 'pr-ready':
      samePhase(story, 'ci');
      if (input.head !== undefined || story.prObservation) {
        requireThat(validHead(input.head), 'Supply the head this readiness decision covers.');
        requireThat(!story.prObservation || input.head === story.prObservation.head,
          'Readiness evidence does not cover the observed head.', 409);
        const review = story.prObservation?.review;
        requireThat(!review?.changesRequested.length, 'Changes are requested on the observed head by ' + review?.changesRequested.join(', ') + '.', 409);
        requireThat(!review?.unresolved, review?.unresolved + ' unresolved review ' + (review?.unresolved === 1 ? 'thread remains' : 'threads remain') + ' on the observed head.', 409);
        story.readyHead = input.head;
      }
      story.phase = 'merge';
      return string(input.detail, 'current-head check and review evidence');
    case 'pr-recheck':
      samePhase(story, 'merge');
      delete story.readyHead;
      story.phase = 'ci';
      return string(input.detail, 'new head or check regression');
    case 'merged':
      requireThat(['ci', 'merge', 'retro', 'pr-review'].includes(story.phase), 'There is no open PR to reconcile in this phase.', 409);
      story.phase = 'closed';
      delete story.blocked;
      return string(input.detail, 'merge evidence');
    default:
      throw new InputError('Unknown event type.');
  }
}

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS stories (id TEXT PRIMARY KEY, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY, key TEXT UNIQUE NOT NULL, story TEXT NOT NULL,
      request TEXT NOT NULL, event TEXT NOT NULL, pending INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_story ON events(story, seq DESC);
    CREATE INDEX IF NOT EXISTS events_pending ON events(seq) WHERE pending = 1;
  `);
  const find = db.prepare('SELECT state FROM stories WHERE id = ?');
  const save = db.prepare('INSERT INTO stories VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state');
  const receipt = db.prepare('SELECT seq, request FROM events WHERE key = ?');
  const insert = db.prepare('INSERT INTO events (key, story, request, event, pending) VALUES (?, ?, ?, ?, ?)');
  const recent = db.prepare('SELECT seq, event FROM events WHERE story = ? ORDER BY seq DESC LIMIT ?');
  const history = db.prepare('SELECT seq, event FROM events WHERE story = ? ORDER BY seq DESC');
  const firstEvent = db.prepare('SELECT event FROM events WHERE story = ? ORDER BY seq LIMIT 1');
  const all = db.prepare('SELECT state FROM stories ORDER BY id');
  const pending = db.prepare('SELECT seq, story, event FROM events WHERE pending = 1 ORDER BY seq');
  const storyPending = db.prepare('SELECT seq, story, event FROM events WHERE pending = 1 AND story = ? ORDER BY seq');
  const pendingDecision = db.prepare(`SELECT seq, event FROM events
    WHERE pending = 1 AND story = ? AND json_extract(event, '$.phase') = ?
    AND json_extract(event, '$.type') IN ('answer', 'approve', 'plan-feedback', 'comparison-choice')
    AND seq > COALESCE((SELECT MAX(seq) FROM events
      WHERE story = ? AND json_extract(event, '$.phase') != ?), 0)
    ORDER BY seq DESC LIMIT 1`);
  const acknowledge = db.prepare('UPDATE events SET pending = 0 WHERE seq = ? AND pending = 1');
  const purgeHistory = db.prepare('DELETE FROM events WHERE story = ? AND seq != ?');
  const wakeRecords = rows => rows.map(({ seq, story, event }) => ({ seq, story, ...JSON.parse(event) }));

  function read(operation) {
    db.exec('BEGIN');
    try {
      const result = operation();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function withHistory(story, limit) {
    const events = recent.all(story.id, limit).map(({ seq, event }) => ({ seq, ...JSON.parse(event) }));
    const decision = pendingDecision.get(story.id, story.phase, story.id, story.phase);
    const first = story.createdAt ? null : firstEvent.get(story.id);
    const createdAt = story.createdAt ?? (first ? JSON.parse(first.event).at : story.updatedAt);
    return { ...story, createdAt, events, pendingDecision: decision ? { seq: decision.seq, at: JSON.parse(decision.event).at } : null };
  }

  return {
    close: () => db.close(),
    snapshot(harness) {
      const selected = harness === undefined ? undefined : harnessKey(string(harness, 'harness', 100));
      return read(() => all.all().map(({ state }) => JSON.parse(state))
        .filter(story => !story.deleted && (selected === undefined || harnessKey(story.harness) === selected))
        .map(story => withHistory(story, 40)));
    },
    pending: () => wakeRecords(pending.all()),
    hasWorker(id) {
      const row = find.get(id);
      return Boolean(row && JSON.parse(row.state).worker);
    },
    history(id) {
      identifier(id, 'story ID');
      const row = find.get(id);
      requireThat(row && !JSON.parse(row.state).deleted, 'Story does not exist.', 404);
      return history.all(id).map(({ seq, event }) => ({ seq, ...JSON.parse(event) }));
    },
    artifact(id, artifactId) {
      identifier(id, 'story ID');
      identifier(artifactId, 'evidence ID');
      const row = find.get(id);
      const story = row && JSON.parse(row.state);
      requireThat(story && !story.deleted, 'Story does not exist.', 404);
      const artifact = story.artifacts?.find(item => item.id === artifactId);
      requireThat(artifact, 'Evidence does not exist.', 404);
      return artifact;
    },
    pendingFor(id) {
      identifier(id, 'story ID');
      const row = find.get(id);
      requireThat(row && !JSON.parse(row.state).deleted, 'Story does not exist.', 404);
      return wakeRecords(storyPending.all(id));
    },
    watchTargets() {
      return all.all().map(({ state }) => JSON.parse(state)).filter(story =>
        !story.cleanup && story.pr && ['ci', 'merge', 'pr-review'].includes(story.phase));
    },
    handover(id) {
      identifier(id, 'story ID');
      return read(() => {
        const row = find.get(id);
        requireThat(row, 'Story does not exist.', 404);
        const story = JSON.parse(row.state);
        requireThat(!story.deleted, 'Story does not exist.', 404);
        return { story: withHistory(story, 10), pending: wakeRecords(storyPending.all(id)) };
      });
    },
    ack(seq) {
      requireThat(Number.isSafeInteger(seq) && seq > 0, 'Invalid wake ID.');
      return { acknowledged: acknowledge.run(seq).changes === 1 };
    },
    record(input) {
      requireThat(input && typeof input === 'object' && !Array.isArray(input), 'Send an event object.');
      const id = identifier(input.story, 'story ID');
      const key = identifier(input.key, 'event key');
      const serialized = JSON.stringify(input);
      requireThat(Buffer.byteLength(serialized) <= 32768, 'Event exceeds 32 KiB.');
      const request = input.type === 'complete-cleanup'
        ? createHash('sha256').update(serialized).digest('hex')
        : serialized;
      db.exec('BEGIN IMMEDIATE');
      try {
        const previous = receipt.get(key);
        if (previous) {
          requireThat(previous.request === request, 'Event key already belongs to a different request.', 409);
          db.exec('COMMIT');
          return { seq: previous.seq, replayed: true };
        }
        const current = find.get(id);
        const now = new Date().toISOString();
        let story;
        let detail;
        let worker;
        let feedback = false;
        requireThat(input.by === undefined || input.by === 'jarvis', 'by can only be jarvis.');
        let wake = wakes.has(input.type) && !input.by;
        if (input.type === 'create') {
          requireThat(!current, 'Story already exists.', 409);
          const title = string(input.title, 'title', 200);
          story = {
            id, title, brief: string(input.detail, 'initial brief', 16000),
            branch: string(input.branch, 'branch', 200), worktree: string(input.worktree, 'worktree', 1000),
            harness: string(input.harness, 'harness', 100),
            ...(input.repo === undefined ? {} : { repo: string(input.repo, 'repository', 200) }),
            phase: 'scout', revision: 0, questions: [], files: [], createdAt: now
          };
          detail = title;
        } else {
          requireThat(current, 'Story does not exist.', 404);
          story = JSON.parse(current.state);
          requireThat(!story.deleted, 'Story does not exist.', 404);
          requireThat(input.revision === story.revision, 'Story changed. Read the latest state and retry.', 409);
          requireThat(input.type === 'select-harness' || input.harness === undefined || input.harness === story.harness,
            'Use the harness selected for this story.', 409);
          const from = story.phase;
          worker = story.worker;
          requireThat(!story.cleanup || jarvisNotice(input) || ['release-worker', 'cleanup-blocked', 'complete-cleanup', 'turn-started', 'turn-ended', ...jarvisTurnEvents].includes(input.type) ||
            (input.type === 'answer' && String(input.question).startsWith('action-jarvis-')),
            'Story is awaiting cleanup.', 409);
          if (input.type === 'request-cleanup') {
            story.cleanup = { requestedAt: now };
            delete story.activity;
            detail = 'Story cleanup requested.';
          } else if (input.type === 'cleanup-blocked') {
            requireThat(story.cleanup, 'Cleanup was not requested.', 409);
            detail = string(input.detail, 'cleanup blocker');
            story.cleanup.blocked = detail;
          } else if (input.type === 'complete-cleanup') {
            requireThat(story.cleanup && !worker, 'Request cleanup and release the worker before completing it.', 409);
            string(input.detail, 'verified cleanup evidence');
            const result = insert.run(key, id, request, '{}', 0);
            purgeHistory.run(id, result.lastInsertRowid);
            save.run(id, JSON.stringify({ id, deleted: true }));
            db.exec('COMMIT');
            return { seq: result.lastInsertRowid, deleted: true };
          } else if (input.type === 'pr-observed') {
            const observed = observePr(story, input, now);
            if (!observed) {
              db.exec('COMMIT');
              return { unchanged: true };
            }
            ({ detail, wake, feedback } = observed);
          } else {
            if (story.cleanup && input.type === 'release-worker') {
              requireThat(worker && worker.id === input.assignment, 'Current assignment does not match.', 409);
              detail = string(input.detail, 'release evidence');
              delete story.worker;
            } else {
              detail = apply(story, input, now);
              if (input.type === 'turn-ended') wake = input.wake === true && !input.by;
            }
          }
          if (from !== story.phase) {
            requireThat(!worker, 'Release the assigned worker before changing phases.', 409);
            delete story.activity;
          }
        }
        story.revision += 1;
        story.updatedAt = now;
        const event = { at: now, type: input.type, phase: story.phase, revision: story.revision, detail };
        if (input.type === 'pr-observed') event.observation = story.prObservation;
        if (feedback) event.feedback = true;
        else if (story.worker || worker) event.worker = story.worker ?? worker;
        if (input.type === 'pr-ready' && story.readyHead) event.head = story.readyHead;
        if (input.command) event.command = input.command;
        if (input.by) event.by = input.by;
        if (input.file) event.file = input.file;
        save.run(id, JSON.stringify(story));
        const result = insert.run(key, id, request, JSON.stringify(event), Number(wake));
        db.exec('COMMIT');
        return { seq: result.lastInsertRowid, revision: story.revision, ...(input.type === 'pr-observed' ? { wake } : {}) };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  };
}
