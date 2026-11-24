import { newlyWaiting, titleFor } from './attention.js';
import { badgeSvg } from './badge.js';
import { renderMarkdown } from './markdown.js';

const $ = id => document.getElementById(id);
let columns = [];
const crewOrder = ['coordinator', 'planner', 'scout', 'tester', 'implementer', 'reviewer', 'verifier', 'watcher', 'diagrammer', 'approver'];
const ACTIVE_MS = 10 * 60 * 1000;
const eventRoles = {
  create: 'coordinator', question: 'planner', 'draft-plan': 'planner', plan: 'planner',
  answer: 'approver', approve: 'approver', 'comparison-choice': 'approver', 'request-cleanup': 'approver',
  'assign-worker': 'coordinator', 'release-worker': 'coordinator', handoff: 'coordinator',
  'pr-opened': 'coordinator', 'pr-observed': 'watcher', 'pr-ready': 'watcher', merged: 'watcher',
};

let meta = { roles: {}, phases: {} };
let stories = [];
let seenSeqs = null;
let lastFrameAt = 0;
const eventTimes = [];
let filterRole = null;
let filterRepo = '';
let view = localStorage.getItem('aisdlc-view') ?? 'lanes';

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style') node.style.cssText = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
};
const md = (text, extra = '') => el('div', { class: ('md ' + extra).trim() }, ...renderMarkdown(text, el));

function showWindow(dialog, title, restore) {
  dialog.querySelector('.win-title').textContent = title;
  dialog.restore = restore;
  $('dock').querySelector(`[data-for="${dialog.id}"]`)?.remove();
  if (!dialog.open) dialog.showModal();
}

for (const dialog of document.querySelectorAll('dialog.win')) {
  const max = dialog.querySelector('[data-win="max"]');
  dialog.querySelector('.win-ctl').addEventListener('click', event => {
    const action = event.target.closest('button')?.dataset.win;
    if (action === 'close') dialog.close();
    if (action === 'max') {
      const on = dialog.classList.toggle('max');
      max.title = on ? 'Restore down' : 'Maximize';
      max.setAttribute('aria-label', max.title);
      max.textContent = on ? '\u2750' : '\u25A1';
    }
    if (action === 'min') {
      const title = dialog.querySelector('.win-title').textContent;
      dialog.close();
      $('dock').append(el('button', {
        type: 'button', 'data-for': dialog.id, title: 'Restore ' + title,
        onclick: e => { e.currentTarget.remove(); dialog.restore ? dialog.restore() : dialog.showModal(); },
      }, el('span', {}, title), el('span', { class: 'dock-up', 'aria-hidden': 'true' }, '\u25B4')));
    }
  });
  dialog.querySelector('.win-bar').addEventListener('dblclick', event => { if (!event.target.closest('button')) max.click(); });
}

function openPlan(story) {
  const reader = $('plan-reader');
  const title = story.id + ' · plan';
  const restore = () => { const current = stories.find(item => item.id === story.id); current?.plan ? openPlan(current) : toast('This plan is no longer waiting for approval.'); };
  if (reader.dataset.story === story.id && reader.dataset.plan === story.plan) { showWindow(reader, title, restore); return; }
  reader.dataset.story = story.id;
  reader.dataset.plan = story.plan ?? '';
  const comments = [];
  const count = el('span', {}, '');
  const refresh = () => { const n = comments.filter(item => item.comment.trim()).length; count.textContent = n ? ' (' + n + ')' : ''; };
  const body = md(story.plan ?? '', 'commentable');
  body.addEventListener('click', event => {
    if (event.target.closest('a, input, textarea, button, .comment-box')) return;
    const target = event.target.closest('li, p, h3, h4, h5, h6, pre, blockquote, tr');
    if (!target || !body.contains(target)) return;
    const existing = comments.find(item => item.target === target);
    if (existing) { existing.box.querySelector('textarea').focus(); return; }
    const quote = (target.matches('li') ? [...target.childNodes].filter(node => !node.matches?.('ul, ol, .comment-box')).map(node => node.textContent).join('') : target.textContent).trim();
    const item = { target, quote, comment: '' };
    const input = el('textarea', { rows: 3, placeholder: 'Your comment on this part of the plan', oninput: e => { item.comment = e.target.value; refresh(); } });
    item.box = el('div', { class: 'comment-box' },
      el('small', {}, 'Comment on: ' + (quote.length > 120 ? quote.slice(0, 120) + '…' : quote)),
      input,
      el('button', { type: 'button', class: 'link', onclick: () => {
        item.box.remove(); target.classList.remove('commented'); comments.splice(comments.indexOf(item), 1); refresh();
      } }, 'Remove'));
    target.classList.add('commented');
    if (target.matches('li')) target.append(item.box);
    else (target.matches('tr') ? target.closest('.md-table') : target).after(item.box);
    comments.push(item);
    input.focus();
  });
  const note = el('textarea', { rows: 3, placeholder: 'Overall feedback (optional)' });
  const send = el('button', { type: 'button', onclick: async e => {
    const payload = comments.filter(item => item.comment.trim()).map(({ quote, comment }) => ({ quote, comment: comment.trim() }));
    if (!payload.length && !note.value.trim()) { toast('Click a part of the plan to comment, or add overall feedback.', true); return; }
    if (await decide(story, { type: 'plan-feedback', comments: payload, note: note.value.trim() }, e.currentTarget)) reader.close();
  } }, 'Request changes', count);
  const approve = el('button', { type: 'button', class: 'primary', onclick: async e => { if (await decide(story, { type: 'approve' }, e.currentTarget)) reader.close(); } }, 'Approve plan');
  $('plan-body').replaceChildren(
    el('small', {}, story.id + ' · plan approval'),
    el('h2', {}, story.title),
    el('p', { class: 'hint' }, 'Click any heading, paragraph, bullet or table row to comment on it.'),
    body,
    el('h3', {}, 'Overall feedback'),
    note);
  $('plan-actions').replaceChildren(send, approve);
  showWindow(reader, title, restore);
}

const initials = alias => (alias || '?').split(/\s+/).map(word => word[0]).join('').slice(0, 2).toUpperCase();
const alias = role => role === 'approver' ? 'You' : meta.roles[role]?.alias ?? role;
const avatar = (role, { small = false, moving = false, label } = {}) => {
  const badge = meta.roles[role]?.badge;
  return el('span', { class: ['avatar', small && 'sm', moving && 'moving', !badge && 'initials'].filter(Boolean).join(' '), title: label, 'aria-label': label, role: label && 'img' },
    badge ? badgeSvg(badge) : initials(alias(role)));
};
const ago = iso => {
  if (!iso) return '';
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return seconds + 's ago';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  return Math.floor(seconds / 86400) + 'd ago';
};

const elapsed = (from, to) => {
  if (!from) return '';
  const minutes = Math.max(0, Math.floor(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 60000));
  if (minutes < 60) return minutes + 'm';
  if (minutes < 1440) return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
  return Math.floor(minutes / 1440) + 'd ' + Math.floor((minutes % 1440) / 60) + 'h';
};

function ownerOf(story) {
  if (story.worker) return story.worker.role;
  if (openQuestions(story).length) return 'approver';
  return meta.phases[story.phase]?.[0] ?? 'coordinator';
}
const openQuestions = story => (story.questions ?? []).filter(question => !question.answer);
const waitingOnYou = story => story.phase === 'approval' || story.phase === 'comparison-choice' || openQuestions(story).length > 0;
const idleReasons = {
  scout: 'no scout session active', gates: 'waiting for the deterministic gates', mutation: 'waiting for the mutation check', retro: 'waiting for the retro',
  planning: 'no planner session active', testing: 'no tester session active', red: 'waiting to verify red',
  building: 'no implementer session active', review: 'waiting for review to start', comparison: 'waiting for before-and-after capture',
  diagram: 'waiting for the diagram', publishing: 'waiting on release pipeline before the PR opens',
  ci: 'waiting on pipeline checks', merge: 'waiting on reviewer approval and merge',
};
const idleReason = story => idleReasons[story.phase] ?? 'no active worker';
function isBusy(story) {
  if (story.phase === 'closed' || story.blocked || waitingOnYou(story)) return false;
  if (story.worker) return Boolean(story.worker.turn) || !story.worker.lastTurn;
  return Boolean(story.activity?.at) && Date.now() - Date.parse(story.activity.at) < ACTIVE_MS;
}
const progress = story => {
  const all = columns.flatMap(column => column.phases);
  return Math.round(((all.indexOf(story.phase) + 1) / all.length) * 100);
};
const columnIndex = story => columns.findIndex(column => column.phases.includes(story.phase));
const belongsTo = (story, role) => ownerOf(story) === role || (role === 'approver' && waitingOnYou(story));
const repos = () => [...new Set(stories.map(story => story.repo).filter(Boolean))].sort();
const visible = () => stories.filter(story => (!filterRole || belongsTo(story, filterRole)) && (!filterRepo || story.repo === filterRepo));

function setFilter(role) {
  filterRole = filterRole === role ? null : role;
  render();
}
function openInbox(story, kind) {
  if (filterRole !== 'approver') setFilter('approver');
  const card = $('decisions').querySelector(`.decision[data-story="${CSS.escape(story)}"][data-kind="${kind}"]`);
  if (!card) return;
  card.scrollIntoView({ block: 'start', behavior: 'smooth' });
  card.classList.add('flash');
  setTimeout(() => card.classList.remove('flash'), 1600);
}
function setView(next) {
  view = next;
  localStorage.setItem('aisdlc-view', next);
  render();
}

function renderStats() {
  const open = stories.filter(story => story.phase !== 'closed');
  $('stat-active').textContent = open.length;
  $('stat-agents').textContent = new Set(open.filter(isBusy).map(ownerOf)).size;
  const waiting = open.filter(waitingOnYou);
  $('stat-waiting').textContent = waiting.length;
  $('stat-shipped').textContent = stories.length - open.length;
  $('stat-waiting').parentElement.classList.toggle('hot', waiting.length > 0);
  document.title = titleFor(waiting.length);
  announce(waiting);
}

let announced = null;
function announce(waiting) {
  const { seen, fresh } = newlyWaiting(announced, waiting.map(story => {
    const questions = openQuestions(story);
    const needs = questions[0]?.prompt ?? (story.phase === 'approval' ? 'The plan is ready for your approval.' : 'A decision is waiting on you.');
    return { key: [story.id, story.phase, ...questions.map(question => question.id)].join('|'), story, needs };
  }));
  announced = seen;
  if (globalThis.Notification?.permission !== 'granted') return;
  for (const { story, needs } of fresh) {
    const notice = new Notification(story.id + ' is waiting on you', { body: story.title + '\n' + needs, tag: story.id });
    notice.onclick = () => { window.focus(); setFilter('approver'); };
  }
}

function renderCrew() {
  const work = new Map();
  for (const story of stories) {
    if (story.phase === 'closed') continue;
    const role = ownerOf(story);
    if (!work.has(role)) work.set(role, []);
    work.get(role).push(story);
  }
  $('crew').classList.toggle('filtering', Boolean(filterRole));
  $('crew').replaceChildren(...crewOrder.filter(role => meta.roles[role]).map(role => {
    const assigned = work.get(role) ?? [];
    const busy = assigned.some(story => role === 'approver' ? waitingOnYou(story) : isBusy(story));
    const state = busy ? (role === 'approver' ? 'needs' : 'busy') : assigned.length ? 'queued' : 'idle';
    return el('button', {
      type: 'button', class: 'agent ' + state + (filterRole === role ? ' selected' : ''), 'data-role': role,
      'aria-pressed': String(filterRole === role),
      title: alias(role) + ' · ' + meta.roles[role].job + (filterRole === role ? ' (click to show everyone)' : ' (click to show only their work)'),
      onclick: () => setFilter(role),
    },
      avatar(role, { moving: state === 'busy' }),
      el('div', { class: 'who' },
        el('b', {}, alias(role)),
        el('small', {}, meta.roles[role].job),
        el('em', {}, assigned.length ? assigned.map(story => story.id).join(', ') : 'standing by')));
  }));
}

function storyCard(story) {
  const role = ownerOf(story);
  const busy = isBusy(story);
  const waiting = waitingOnYou(story);
  const last = story.events?.[0];
  const idle = !busy && !waiting && !story.blocked && story.phase !== 'closed';
  const label = alias(role) + ' · ' + (meta.phases[story.phase]?.[1] ?? story.phase);
  const placement = story.id + ':' + story.phase;
  const arriving = !seenCards.has(placement);
  seenCards.add(placement);
  return el('article', {
    class: ['card', arriving && 'new', busy && 'busy', waiting && 'waiting', story.blocked && 'blocked', story.phase === 'closed' && 'done', idle && 'idle'].filter(Boolean).join(' '),
    'data-role': role, tabindex: 0,
    onclick: () => openDetail(story.id),
    onkeydown: event => event.key === 'Enter' && openDetail(story.id),
  },
    el('header', {},
      el('span', { class: 'id' }, story.id),
      idle ? el('span', { class: 'avatar sm', title: label, 'aria-label': label, role: 'img' }, '··') : avatar(role, { small: true, moving: busy, label })),
    el('h3', {}, story.title),
    last && (waiting || story.blocked) && el('p', { class: 'last' }, last.detail),
    el('div', { class: 'owner' },
      !busy && el('span', { class: 'who' }, story.blocked ? 'Blocked' : waiting ? 'Waiting on you' : story.phase === 'closed' ? 'Done' : 'Idle · ' + idleReason(story)),
      el('span', { class: 'aside' },
        el('span', { class: 'links' },
          hasDesign(story) && el('a', { href: '#', onclick: event => { event.preventDefault(); event.stopPropagation(); openDesign(story.id); } }, 'Plan'),
          story.pipeline && el('a', { href: story.pipeline, target: '_blank', rel: 'noopener', onclick: event => event.stopPropagation() }, 'Run')),
        story.pr && el('a', { href: story.pr, target: '_blank', rel: 'noopener', onclick: event => event.stopPropagation() }, 'PR'),
        el('time', { 'data-at': story.updatedAt }, ago(story.updatedAt)))),
    el('div', { class: 'meter' }, el('span', { style: 'transform:scaleX(' + progress(story) / 100 + ')' })));
}

function renderToolbar() {
  for (const button of document.querySelectorAll('.views button')) button.setAttribute('aria-selected', String(button.dataset.view === view));
  const names = repos();
  const picker = $('repo-filter');
  picker.hidden = names.length < 2;
  picker.replaceChildren(el('option', { value: '' }, 'All repositories'), ...names.map(name => el('option', { value: name }, name)));
  picker.value = filterRepo;
  const filter = $('filter');
  filter.hidden = !filterRole;
  if (!filterRole) return filter.replaceChildren();
  filter.dataset.role = filterRole;
  filter.replaceChildren(
    avatar(filterRole, { small: true }),
    el('span', {}, 'Only ' + (filterRole === 'approver' ? 'your' : alias(filterRole) + '\u2019s') + ' work · ' + visible().length + ' of ' + stories.length),
    el('button', { type: 'button', onclick: () => setFilter(filterRole), 'aria-label': 'Clear filter' }, 'Show everyone'));
}

function emptyBoard() {
  return el('p', { class: 'empty' }, filterRole ? alias(filterRole) + ' has nothing assigned right now' + (filterRepo ? ' in ' + filterRepo : '') + '.' : 'No stories yet.');
}

function renderLanes(items) {
  return columns.map(column => {
    const here = items.filter(story => column.phases.includes(story.phase));
    return el('div', { class: 'lane' + (here.some(isBusy) ? ' hot' : '') + (here.length ? '' : ' empty') },
      el('h2', {}, column.name, el('span', {}, here.length)),
      el('div', { class: 'cards' }, here.map(storyCard)));
  });
}

function renderAgents(items) {
  const rows = crewOrder.map(role => [role, items.filter(story => ownerOf(story) === role)]).filter(([, list]) => list.length);
  if (!rows.length) return [emptyBoard()];
  return rows.map(([role, list]) => {
    const busy = list.some(story => role === 'approver' ? waitingOnYou(story) : isBusy(story));
    return el('section', { class: 'swim' + (busy ? ' hot' : ''), 'data-role': role },
      el('button', { type: 'button', class: 'swim-head', onclick: () => setFilter(role), title: 'Filter to ' + alias(role) },
        avatar(role, { moving: busy && role !== 'approver' }),
        el('span', { class: 'who' }, el('b', {}, alias(role)), el('small', {}, meta.roles[role]?.job ?? ''), el('em', {}, list.length + (list.length === 1 ? ' story' : ' stories')))),
      el('div', { class: 'swim-cards' }, [...list].sort((a, b) => columnIndex(a) - columnIndex(b)).map(storyCard)));
  });
}

function renderTrack(items) {
  if (!items.length) return [emptyBoard()];
  const sorted = [...items].sort((a, b) => (a.phase === 'closed') - (b.phase === 'closed') || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return [el('div', { class: 'track-head' }, el('span', {}, 'Story'), el('ol', { class: 'steps legend' }, columns.map(column => el('li', {}, column.name))))]
    .concat(sorted.map(story => {
      const role = ownerOf(story);
      const busy = isBusy(story);
      const waiting = waitingOnYou(story);
      const at = columnIndex(story);
      const last = story.events?.[0];
      const idle = !busy && !waiting && !story.blocked && story.phase !== 'closed';
      return el('article', {
        class: ['track', busy && 'busy', waiting && 'waiting', story.blocked && 'blocked', story.phase === 'closed' && 'done', idle && 'idle'].filter(Boolean).join(' '),
        'data-role': role, tabindex: 0,
        onclick: () => openDetail(story.id),
        onkeydown: event => event.key === 'Enter' && openDetail(story.id),
      },
        el('div', { class: 'track-info' },
          el('header', {}, el('span', { class: 'id' }, story.id),
            el('time', {
              class: 'elapsed', 'data-since': story.createdAt, ...(story.phase === 'closed' ? { 'data-until': story.updatedAt } : {}),
              title: 'Started ' + new Date(story.createdAt).toLocaleString() + (story.phase === 'closed' ? '' : ' · updated ' + ago(story.updatedAt)),
            }, elapsed(story.createdAt, story.phase === 'closed' ? story.updatedAt : undefined))),
          el('h3', {}, story.title),
          el('div', { class: 'owner' },
            el('span', {}, (meta.phases[story.phase]?.[1] ?? columns[at]?.name ?? story.phase) + (story.blocked ? ' · blocked' : waiting ? ' · waiting on you' : idle ? ' · idle, ' + idleReason(story) : '')),
            busy && el('span', { class: 'dots' }, el('i'), el('i'), el('i')))),
        el('div', { class: 'track-run' },
          el('ol', { class: 'steps' }, columns.map((column, index) =>
            el('li', { class: index < at ? 'past' : index === at ? 'now' : '', title: column.name }, el('span', {}, index === at ? meta.phases[story.phase]?.[1] ?? column.name : column.name)))),
          last && el('p', { class: 'last' }, last.detail)));
    }));
}

function renderBoard() {
  $('empty').hidden = stories.length > 0;
  const items = visible();
  const board = $('board');
  board.className = 'board view-' + view;
  board.replaceChildren(...(view === 'agents' ? renderAgents(items) : view === 'track' ? renderTrack(items) : renderLanes(items)));
}

async function decide(story, event, button) {
  button.disabled = true;
  try {
    await post(story, event);
    toast('Sent to Jarvis');
    return true;
  } catch (error) {
    toast(error.message, true);
    button.disabled = false;
    return false;
  }
}

async function post(story, event, revision = latest(story.id).revision) {
  const response = await fetch('/api/decision', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ story: story.id, revision, ...event }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error);
  return body;
}

const latest = id => stories.find(story => story.id === id) ?? { revision: undefined };
const drafts = new Map();
const baselines = new Map();
const draftOf = (story, question) => {
  const key = story.id + ':' + question.id;
  if (!drafts.has(key)) drafts.set(key, { choice: null, text: '', shots: [] });
  return drafts.get(key);
};
const answered = draft => draft.choice !== null || draft.text.trim() || draft.shots.length;
const refreshInbox = () => { delete signatures.decisions; render(); };

async function upload(story, files, into) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    try {
      const response = await fetch('/api/attachment?story=' + encodeURIComponent(story.id), { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      into.push(body);
      toast('Screenshot attached');
    } catch (error) {
      toast(error.message, true);
    }
  }
  refreshInbox();
}

function shotPicker(story, shots, label) {
  const input = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, hidden: true,
    onchange: event => upload(story, [...event.target.files], shots) });
  return el('div', { class: 'shots' },
    shots.map((shot, index) => el('figure', {},
      el('a', { href: shot.url, target: '_blank', rel: 'noopener' }, el('img', { src: shot.url, alt: 'Attached screenshot ' + (index + 1) })),
      el('button', { type: 'button', class: 'x', 'aria-label': 'Remove screenshot', onclick: () => { shots.splice(index, 1); refreshInbox(); } }, '×'))),
    el('button', { type: 'button', class: 'attach', onclick: () => input.click() }, '+ ' + label),
    input);
}

function answerValue(question, draft) {
  if (!draft.text.trim() && !draft.shots.length) return draft.choice;
  const parts = [];
  if (draft.choice !== null) parts.push(question.options[draft.choice]);
  if (draft.text.trim()) parts.push(draft.text.trim());
  if (draft.shots.length) parts.push('Screenshots:\n' + draft.shots.map(shot => '- ' + shot.path).join('\n'));
  return parts.join('\n\n');
}

async function sendAnswers(story, questions, button) {
  const ready = questions.filter(question => answered(draftOf(story, question)));
  if (!ready.length) return toast('Pick or write an answer first', true);
  button.disabled = true;
  let revision = latest(story.id).revision;
  try {
    for (const question of ready) {
      ({ revision } = await post(story, { type: 'answer', question: question.id, answer: answerValue(question, draftOf(story, question)) }, revision));
      drafts.delete(story.id + ':' + question.id);
    }
    toast(ready.length === 1 ? 'Answer sent to Jarvis' : ready.length + ' answers sent to Jarvis');
  } catch (error) {
    toast(error.message, true);
  }
  button.disabled = false;
  refreshInbox();
}

function questionBlock(story, question, index, total) {
  const draft = draftOf(story, question);
  const promptId = 'q-' + story.id + '-' + question.id;
  const area = el('textarea', { rows: 2, placeholder: 'Or answer in your own words. Paste screenshots here.',
    oninput: event => {
      draft.text = event.target.value;
      if (draft.text.trim() && draft.choice !== null) {
        draft.choice = null;
        for (const button of event.target.closest('.question').querySelectorAll('.choices button')) button.setAttribute('aria-pressed', 'false');
      }
      event.target.closest('.decision')?.dispatchEvent(new Event('draft'));
    },
    onpaste: event => {
      const files = [...event.clipboardData.items].filter(item => item.type.startsWith('image/')).map(item => item.getAsFile());
      if (files.length) { event.preventDefault(); upload(story, files, draft.shots); }
    } });
  area.value = draft.text;
  return el('section', { class: 'question' + (answered(draft) ? ' ready' : ''), role: 'group', 'aria-labelledby': promptId },
    el('small', { class: 'q-num' }, 'Question ' + (index + 1) + ' of ' + total + (answered(draft) ? ' · answered' : '')),
    el('p', { class: 'q-prompt', id: promptId }, question.prompt),
    el('div', { class: 'choices' }, question.options.map((option, index) =>
      el('button', { type: 'button', 'aria-pressed': String(draft.choice === index),
        onclick: () => { draft.choice = draft.choice === index ? null : index; if (draft.choice !== null) draft.text = ''; refreshInbox(); } },
        option, index === question.recommended ? el('span', { class: 'rec' }, 'recommended') : null))),
    area,
    shotPicker(story, draft.shots, 'Screenshot'));
}

function renderDecisions() {
  const cards = [];
  const focus = filterRole === 'approver';
  for (const story of stories) {
    const open = openQuestions(story);
    if (open.length) {
      const count = el('span', {});
      const card = el('div', { class: 'decision grooming', 'data-story': story.id, 'data-kind': 'grooming' },
        el('header', {}, el('small', {}, story.id + (story.phase === 'planning' ? ' · grooming · ' : ' · decision · ') + open.length + (open.length === 1 ? ' question' : ' questions')),
          el('button', { type: 'button', class: 'link', onclick: () => openDetail(story.id) }, 'Details')),
        el('p', { class: 'title' }, story.title),
        story.draftPlan && el('details', {}, el('summary', {}, 'Working plan so far'), md(story.draftPlan.text, 'scroll')),
        open.map((question, index) => questionBlock(story, question, index, open.length)),
        el('div', { class: 'send' },
          el('button', { type: 'button', class: 'primary', onclick: e => sendAnswers(story, open, e.currentTarget) }, 'Send answers ', count),
          el('button', { type: 'button', onclick: e => {
            for (const question of open) { const draft = draftOf(story, question); if (!answered(draft)) draft.choice = question.recommended; }
            refreshInbox();
          } }, 'Use recommended for the rest')));
      const update = () => { const n = open.filter(question => answered(draftOf(story, question))).length; count.textContent = n + '/' + open.length; };
      card.addEventListener('draft', update);
      update();
      cards.push(card);
    }
    if (story.phase === 'approval') {
      cards.push(el('div', { class: 'decision', 'data-story': story.id, 'data-kind': 'plan' },
        el('header', {}, el('small', {}, story.id + ' · plan approval'), el('button', { type: 'button', class: 'link', onclick: () => openDetail(story.id) }, 'Details')),
        el('p', { class: 'title' }, story.title),
        md(story.plan ?? '', 'scroll' + (focus ? ' tall' : '')),
        el('div', { class: 'send' },
          el('button', { type: 'button', class: 'primary', onclick: e => decide(story, { type: 'approve' }, e.currentTarget) }, 'Approve plan'),
          el('button', { type: 'button', onclick: () => openPlan(story) }, 'Read, comment or request changes'))));
    }
    if (story.phase === 'comparison-choice') {
      if (!baselines.has(story.id)) baselines.set(story.id, []);
      cards.push(el('div', { class: 'decision', 'data-story': story.id, 'data-kind': 'compare' },
        el('header', {}, el('small', {}, story.id + ' · before and after'), el('button', { type: 'button', class: 'link', onclick: () => openDetail(story.id) }, 'Details')),
        el('p', { class: 'title' }, 'Capture before-and-after evidence for ' + story.title + '?'),
        el('p', { class: 'hint' }, 'Optional: attach baseline screenshots and Jarvis will use them as the "before".'),
        shotPicker(story, baselines.get(story.id), 'Baseline screenshot'),
        el('div', { class: 'send' },
          el('button', { type: 'button', class: 'primary', onclick: e => decide(story, { type: 'comparison-choice', run: true }, e.currentTarget) }, 'Capture it'),
          el('button', { type: 'button', onclick: e => decide(story, { type: 'comparison-choice', run: false }, e.currentTarget) }, 'Skip'))));
    }
  }
  const tray = $('decisions');
  if (!focus) {
    const rows = cards.map(card => el('button', { type: 'button', class: 'pending-row', onclick: () => openInbox(card.dataset.story, card.dataset.kind) },
      el('small', {}, card.querySelector('small').textContent),
      el('span', {}, card.querySelector('.title').textContent),
      el('em', {}, 'Answer →')));
    tray.hidden = cards.length === 0;
    tray.classList.remove('focus');
    $('board').hidden = false;
    tray.replaceChildren(el('h2', {}, 'Waiting on you · ' + cards.length,
      el('button', { type: 'button', class: 'link', onclick: () => setFilter('approver') }, 'Open inbox')), ...rows);
    return;
  }
  tray.hidden = false;
  tray.classList.toggle('focus', focus);
  $('board').hidden = focus;
  const header = el('h2', {}, 'Waiting on you · ' + cards.length,
    focus ? el('button', { type: 'button', class: 'link', onclick: () => setFilter('approver') }, 'Back to board')
      : el('button', { type: 'button', class: 'link', onclick: () => setFilter('approver') }, 'Open inbox'));
  tray.replaceChildren(header, ...(cards.length ? cards : [el('p', { class: 'empty' }, 'Nothing is waiting on you. Jarvis will post grooming questions here.')]));
}

let unread = 0;
const feedMinimized = () => document.body.classList.contains('feed-min');
const showUnread = () => { $('feed-unread').hidden = !unread; $('feed-unread').textContent = unread; };
function setFeedMinimized(minimized) {
  document.body.classList.toggle('feed-min', minimized);
  localStorage.setItem('aisdlc-feed-min', minimized ? '1' : '');
  const toggle = $('feed-toggle');
  toggle.textContent = minimized ? '+' : '−';
  toggle.title = minimized ? 'Restore live feed' : 'Minimize live feed';
  toggle.setAttribute('aria-label', toggle.title);
  toggle.setAttribute('aria-expanded', String(!minimized));
  if (!minimized) { unread = 0; showUnread(); }
}
$('feed-toggle').addEventListener('click', event => { event.stopPropagation(); setFeedMinimized(!feedMinimized()); });
$('feed-panel').addEventListener('click', () => { if (feedMinimized()) setFeedMinimized(false); });
setFeedMinimized(localStorage.getItem('aisdlc-feed-min') === '1');

function renderFeed() {
  if (!lastFrameAt) return;
  const ids = new Set(visible().map(story => story.id));
  const events = stories.filter(story => ids.has(story.id)).flatMap(story => (story.events ?? []).map(event => ({ ...event, story: story.id, title: story.title })))
    .sort((a, b) => b.seq - a.seq).slice(0, 80);
  const fresh = seenSeqs ? events.filter(event => !seenSeqs.has(event.seq)) : [];
  seenSeqs = new Set(events.map(event => event.seq));
  for (const event of fresh) eventTimes.push(Date.now());
  if (feedMinimized() && fresh.length) { unread += fresh.length; showUnread(); }
  $('feed').replaceChildren(...events.map(event => {
    const role = eventRoles[event.type] ?? meta.phases[event.phase]?.[0] ?? 'coordinator';
    return el('li', { class: fresh.some(item => item.seq === event.seq) ? 'new' : '', 'data-role': role },
      avatar(role, { small: true }),
      el('div', {},
        el('div', { class: 'meta' }, el('b', {}, event.story), el('span', {}, event.type), el('time', { 'data-at': event.at }, ago(event.at))),
        el('p', {}, event.detail ?? '')));
  }));
}

const designOf = story => (story.artifacts ?? []).findLast(artifact => artifact.kind === 'document' && /design[^\\/]*\.md$/i.test(artifact.path));
const hasDesign = story => !['scout', 'planning', 'approval'].includes(story.phase) && Boolean(story.plan || designOf(story));
const mediaUrl = (story, artifact) => '/api/media?' + new URLSearchParams({ story: story.id, id: artifact.id });

async function openDesign(id) {
  const story = stories.find(item => item.id === id);
  if (!story) return;
  const design = designOf(story);
  let text = story.plan ?? '';
  let source = 'Approved plan recorded in the story (no design file registered).';
  if (design) {
    try {
      const response = await fetch(mediaUrl(story, design));
      if (!response.ok) throw new Error();
      text = await response.text();
      source = 'Preserved design · ' + design.path;
    } catch {
      source = 'The preserved design is unavailable or changed. Showing the plan recorded in the story.';
    }
  }
  $('detail-body').replaceChildren(
    el('small', {}, story.id + ' · approved plan and design'),
    el('h2', {}, story.title),
    el('p', { class: 'hint' }, source),
    md(text),
    el('p', {}, el('button', { type: 'button', class: 'link', onclick: () => openDetail(id) }, 'Back to details')));
  showWindow($('detail'), story.id + ' · plan', () => openDesign(id));
}

function evidenceItem(story, artifact) {
  const url = mediaUrl(story, artifact);
  const caption = artifact.kind + ' · ' + artifact.caption;
  if (artifact.kind === 'document') return el('li', {}, el('a', { href: url, target: '_blank', rel: 'noopener' }, caption + ' (' + artifact.path.split(/[\\/]/).pop() + ')'));
  if (/\.(mp4|webm)$/i.test(artifact.path)) return el('li', {}, el('p', {}, caption), el('video', { src: url, controls: true, preload: 'metadata' }));
  return el('li', {}, el('p', {}, caption), el('a', { href: url, target: '_blank', rel: 'noopener' }, el('img', { src: url, alt: artifact.caption, loading: 'lazy', style: 'max-width:100%' })));
}

const turnOutcomes = { ended: 'Ended', failed: 'Failed', lost: 'Stopped, cause unknown' };
function turnOf(worker) {
  if (worker?.turn) return 'Running, started ' + ago(worker.turn.at) + ' (process ' + worker.turn.pid + ')';
  if (worker?.lastTurn) return turnOutcomes[worker.lastTurn.outcome] + ' ' + ago(worker.lastTurn.at);
  return null;
}

function modelOf(story) {
  const ran = story.worker?.ran;
  if (ran) return ran.model + (ran.effort ? ' · ' + ran.effort + ' effort' : '');
  const tier = meta.phaseTiers?.[story.phase];
  if (!tier) return null;
  const chosen = meta.models?.[story.harness?.trim().toLowerCase()] ?? {};
  if (chosen[tier] === null) return story.harness + ' default · chosen in the profile';
  const named = chosen[tier];
  return named ? named + ' · set in the profile, not run yet' : 'Not run yet · ' + story.harness + ' will choose';
}

function openDetail(id) {
  const story = stories.find(item => item.id === id);
  if (!story) return;
  const row = (label, value) => value ? el('div', { class: 'row' }, el('dt', {}, label), el('dd', {}, value)) : null;
  $('detail-body').replaceChildren(...[
    el('small', {}, story.id + ' · ' + (meta.phases[story.phase]?.[1] ?? story.phase)),
    el('h2', {}, story.title),
    el('p', {}, story.brief),
    el('dl', {},
      row('Owner', alias(ownerOf(story)) + ' · ' + (meta.roles[ownerOf(story)]?.job ?? '')),
      row('Worker session', story.worker?.session),
      row('Worker turn', turnOf(story.worker)),
      row('Repository', story.repo), row('Harness', story.harness), row('Model', modelOf(story)), row('Branch', story.branch), row('Worktree', story.worktree),
      row('Pipeline run', story.pipeline && el('a', { href: story.pipeline, target: '_blank', rel: 'noopener' }, story.pipeline)),
      row('Pull request', story.pr && el('a', { href: story.pr, target: '_blank', rel: 'noopener' }, story.pr)),
      row('Review round', story.reviewRounds ? String(story.reviewRounds + 1) : null),
      row('Blocked', story.blocked)),
    hasDesign(story) && el('p', {}, el('button', { type: 'button', class: 'primary', onclick: () => openDesign(id) }, 'Read approved plan and design')),
    story.plan && el('section', {}, el('h3', {}, 'Plan'), md(story.plan)),
    story.artifacts?.length > 0 && el('section', {}, el('h3', {}, 'Evidence'), el('ul', { class: 'evidence' }, story.artifacts.map(artifact => evidenceItem(story, artifact)))),
    story.files?.length > 0 && el('section', {}, el('h3', {}, 'Files'), el('ul', {}, story.files.map(file => el('li', {}, el('code', {}, file.path), ' ', file.change)))),
    el('section', {}, el('h3', {}, 'Timeline'), el('ol', { class: 'timeline' }, (story.events ?? []).map(event =>
      el('li', {}, el('time', {}, new Date(event.at).toLocaleString()), ' ', el('b', {}, event.type), ' ', event.detail ?? '')))),
  ].filter(Boolean));
  showWindow($('detail'), story.id + ' · ' + (meta.phases[story.phase]?.[1] ?? story.phase), () => openDetail(id));
}

function toast(message, error = false) {
  const node = $('toast');
  node.textContent = message;
  node.className = 'toast show' + (error ? ' error' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.className = 'toast'; }, 3000);
}

const signatures = {};
const changed = (name, value) => {
  const next = JSON.stringify(value);
  if (signatures[name] === next) return false;
  signatures[name] = next;
  return true;
};
const seenCards = new Set();

function render() {
  renderStats();
  const busyKey = stories.map(story => [story.id, isBusy(story)]);
  if (changed('crew', [stories, busyKey, filterRole])) renderCrew();
  if (filterRepo && !repos().includes(filterRepo)) filterRepo = '';
  if (changed('toolbar', [view, filterRole, filterRepo, repos(), stories.length, visible().length])) renderToolbar();
  const decisionKey = [filterRole === 'approver', stories.map(story => [story.id, story.phase, openQuestions(story).map(question => question.id), story.plan, story.draftPlan?.text])];
  if (changed('decisions', decisionKey)) renderDecisions();
  if (changed('board', [stories, busyKey, view, filterRole, filterRepo])) renderBoard();
  if (changed('feed', [lastFrameAt > 0, stories.map(story => story.events?.[0]?.seq), filterRole, filterRepo])) renderFeed();
}

function tick() {
  $('clock').textContent = new Date().toLocaleTimeString();
  for (const node of document.querySelectorAll('time[data-at]')) node.textContent = ago(node.dataset.at);
  for (const node of document.querySelectorAll('time[data-since]')) node.textContent = elapsed(node.dataset.since, node.dataset.until);
  while (eventTimes.length && Date.now() - eventTimes[0] > 60000) eventTimes.shift();
  $('feed-rate').textContent = eventTimes.length ? eventTimes.length + ' events/min' : '';
  const stale = Date.now() - lastFrameAt > 5000;
  $('live').classList.toggle('down', stale);
  $('live-label').textContent = !lastFrameAt ? 'CONNECTING' : stale ? 'RECONNECTING' : 'LIVE';
  render();
}

function connect() {
  const source = new EventSource('/events');
  source.addEventListener('stories', message => {
    const frame = JSON.parse(message.data);
    stories = frame.stories;
    lastFrameAt = Date.now();
    render();
  });
  source.addEventListener('beat', () => { lastFrameAt = Date.now(); });
}

meta = await (await fetch('/api/meta')).json();
columns = meta.columns;
if (!['lanes', 'agents', 'track'].includes(view)) view = 'lanes';
for (const button of document.querySelectorAll('.views button')) button.addEventListener('click', () => setView(button.dataset.view));
$('stat-waiting-button').addEventListener('click', () => setFilter('approver'));
$('repo-filter').addEventListener('change', event => { filterRepo = event.target.value; render(); });
$('notify').hidden = globalThis.Notification?.permission !== 'default';
$('notify').addEventListener('click', async () => {
  await Notification.requestPermission();
  $('notify').hidden = true;
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && filterRole && !$('detail').open) setFilter(filterRole);
});
connect();
tick();
setInterval(tick, 1000);
