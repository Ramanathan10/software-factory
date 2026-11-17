import { DatabaseSync } from 'node:sqlite';

const workers = {
  planning: 'Captain America',
  testing: 'Doctor Strange',
  red: 'Jarvis',
  building: 'Iron Man',
  review: 'Banner',
  comparison: 'Jarvis',
  ci: 'Hawkeye',
};
const transitions = {
  testing: 'red',
  red: 'building',
  building: 'review',
  review: 'comparison-choice',
  comparison: 'publishing',
};
const wakes = new Set([
  'create', 'question', 'answer', 'plan', 'approve', 'handoff', 'return-to-build',
  'comparison-choice', 'replan', 'blocked', 'resume', 'assign-worktree', 'pr-opened', 'pr-ready', 'pr-recheck', 'merged',
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
  samePhase(story, 'planning');
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
  samePhase(story, 'planning');
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

function apply(story, input, now) {
  requireThat(!story.blocked || ['resume', 'answer', 'replan', 'assign-worktree'].includes(input.type),
    'Resume or replan the blocked story first.', 409);
  switch (input.type) {
    case 'question':
      return addQuestion(story, input);
    case 'answer':
      return answerQuestion(story, input);
    case 'plan':
      samePhase(story, 'planning');
      requireThat(story.questions.every(question => question.answer), 'Cap still has open questions.', 409);
      story.plan = string(input.detail, 'plan', 16000);
      story.phase = 'approval';
      return 'Cap submitted the plan for approval.';
    case 'approve':
      samePhase(story, 'approval');
      story.phase = 'testing';
      return 'Fury approved the plan.';
    case 'activity':
      requireThat(workers[story.phase], 'This phase has no reporting worker.', 409);
      if (input.file !== undefined) {
        const path = string(input.file, 'file', 1000);
        const change = string(input.change, 'change summary', 300);
        const diff = input.diff === undefined ? '' : string(input.diff, 'diff', 3000);
        const previous = story.files.findIndex(file => file.path === path);
        const file = { path, change, diff, at: now };
        if (previous >= 0) story.files[previous] = file;
        else story.files.push(file);
      }
      story.activity = { at: now, worker: workers[story.phase] };
      return string(input.detail, 'activity');
    case 'handoff':
      requireThat(transitions[story.phase], 'This phase has no handoff.', 409);
      if (story.phase === 'red' || story.phase === 'building') string(input.command, 'verification command');
      story.phase = transitions[story.phase];
      return string(input.detail, 'handoff evidence');
    case 'return-to-build':
      samePhase(story, 'review');
      story.phase = 'building';
      return string(input.detail, 'review finding');
    case 'replan':
      requireThat(story.phase !== 'planning' && story.phase !== 'closed',
        'This phase cannot reopen planning.', 409);
      story.phase = 'planning';
      delete story.blocked;
      return string(input.detail, 'unresolved decision');
    case 'assign-worktree': {
      requireThat(story.phase !== 'closed', 'The story is closed.', 409);
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
      story.phase = input.run ? 'comparison' : 'publishing';
      return input.run ? 'Fury requested before-and-after.' : 'Fury declined before-and-after.';
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
      story.phase = 'merge';
      return string(input.detail, 'current-head check and review evidence');
    case 'pr-recheck':
      samePhase(story, 'merge');
      story.phase = 'ci';
      return string(input.detail, 'new head or check regression');
    case 'merged':
      requireThat(['ci', 'merge'].includes(story.phase), 'There is no open PR to reconcile in this phase.', 409);
      story.phase = 'closed';
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
  const recent = db.prepare('SELECT seq, event FROM events WHERE story = ? ORDER BY seq DESC LIMIT 40');
  const all = db.prepare('SELECT state FROM stories ORDER BY id');
  const pending = db.prepare('SELECT seq, story, event FROM events WHERE pending = 1 ORDER BY seq');
  const acknowledge = db.prepare('UPDATE events SET pending = 0 WHERE seq = ? AND pending = 1');

  return {
    close: () => db.close(),
    snapshot() {
      db.exec('BEGIN');
      try {
        const stories = all.all().map(({ state }) => {
          const story = JSON.parse(state);
          const events = recent.all(story.id).map(({ seq, event }) => ({ seq, ...JSON.parse(event) }));
          return { ...story, events };
        });
        db.exec('COMMIT');
        return stories;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    pending: () => pending.all().map(({ seq, story, event }) => ({ seq, story, ...JSON.parse(event) })),
    ack(seq) {
      requireThat(Number.isSafeInteger(seq) && seq > 0, 'Invalid wake ID.');
      return { acknowledged: acknowledge.run(seq).changes === 1 };
    },
    record(input) {
      requireThat(input && typeof input === 'object' && !Array.isArray(input), 'Send an event object.');
      const id = identifier(input.story, 'story ID');
      const key = identifier(input.key, 'event key');
      const request = JSON.stringify(input);
      requireThat(Buffer.byteLength(request) <= 32768, 'Event exceeds 32 KiB.');
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
        if (input.type === 'create') {
          requireThat(!current, 'Story already exists.', 409);
          const title = string(input.title, 'title', 200);
          story = {
            id, title, brief: string(input.detail, 'initial brief', 16000),
            branch: string(input.branch, 'branch', 200), worktree: string(input.worktree, 'worktree', 1000),
            phase: 'planning', revision: 0, questions: [], files: []
          };
          detail = title;
        } else {
          requireThat(current, 'Story does not exist.', 404);
          story = JSON.parse(current.state);
          requireThat(input.revision === story.revision, 'Story changed. Read the latest state and retry.', 409);
          const from = story.phase;
          detail = apply(story, input, now);
          if (from !== story.phase) delete story.activity;
        }
        story.revision += 1;
        story.updatedAt = now;
        const event = { at: now, type: input.type, phase: story.phase, revision: story.revision, detail };
        if (input.command) event.command = input.command;
        if (input.file) event.file = input.file;
        save.run(id, JSON.stringify(story));
        const result = insert.run(key, id, request, JSON.stringify(event), Number(wakes.has(input.type)));
        db.exec('COMMIT');
        return { seq: result.lastInsertRowid, revision: story.revision };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  };
}
