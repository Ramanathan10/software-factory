const ui = id => document.getElementById(id);
const workflow = [
  ['Plan', ['planning', 'approval']],
  ['Test', ['testing', 'red']],
  ['Build', ['building']],
  ['Review', ['review', 'comparison-choice', 'comparison']],
  ['PR', ['publishing', 'ci', 'merge', 'closed']],
];
const phases = {
  planning: ['Captain America', 'Planning'],
  approval: ['Fury', 'Plan approval'],
  testing: ['Doctor Strange', 'Writing tests'],
  red: ['Jarvis', 'Verify red'],
  building: ['Iron Man', 'Implementation'],
  review: ['Banner', 'Review'],
  'comparison-choice': ['Fury', 'Before-and-after decision'],
  comparison: ['Jarvis', 'Verify comparison'],
  publishing: ['Jarvis', 'Open pull request'],
  ci: ['Hawkeye', 'Watching checks'],
  merge: ['Hawkeye', 'PR ready to merge'],
  closed: ['Jarvis', 'Merged'],
};
const roles = ['Jarvis', 'Captain America', 'Black Widow', 'Doctor Strange', 'Iron Man', 'Banner', 'Hawkeye'];
let stories = [];
let selected;
let view = 'stories';
let refreshing;
let submitting = false;
let questionStory;
let detailKey;

function node(tag, text, classes) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (classes) element.className = classes;
  return element;
}

function status(story) {
  if (story.phase === 'planning' && story.questions.some(question => !question.answer)) {
    return { owner: 'Captain America', label: 'Answer Cap', decision: true };
  }
  if (story.blocked) return { owner: phases[story.phase][0], label: 'Blocked' };
  const [owner, label] = phases[story.phase];
  return { owner, label, decision: owner === 'Fury' };
}

function storyButton(story, showOwner) {
  const state = status(story);
  const button = node('button');
  button.type = 'button';
  button.setAttribute('aria-pressed', String(story.id === selected));
  button.append(node('span', story.id + ' · ' + story.title));
  button.append(node('span', (showOwner ? state.owner + ' · ' : '') + state.label, 'muted'));
  button.addEventListener('click', () => {
    selected = story.id;
    ui('submit-status').textContent = '';
    render();
    const target = ui('story-title');
    target.tabIndex = -1;
    target.focus();
  });
  return button;
}

function renderOverview() {
  const decisions = stories.filter(story => status(story).decision);
  ui('attention').replaceChildren(...(decisions.length
    ? decisions.map(story => storyButton(story, false))
    : [node('p', 'No decisions waiting.', 'muted')]));
  ui('overview-title').textContent = view === 'stories' ? 'Stories' : 'Crew';
  ui('stories-tab').setAttribute('aria-pressed', String(view === 'stories'));
  ui('crew-tab').setAttribute('aria-pressed', String(view === 'crew'));
  if (view === 'stories') {
    ui('overview').replaceChildren(...stories.map(story => storyButton(story, true)));
  } else {
    ui('overview').replaceChildren(...roles.map(role => {
      const assignments = stories.filter(story => story.phase !== 'closed' && status(story).owner === role);
      const group = node('section', '', 'panel');
      group.append(node('h3', role), node('p', assignments.length + ' assigned', 'muted'));
      group.append(...assignments.map(story => storyButton(story, false)));
      return group;
    }));
  }
}

function questionForm(story, question) {
  const form = node('form');
  const fields = node('fieldset');
  fields.append(node('legend', question.prompt));
  const custom = node('textarea');
  custom.rows = 3;
  custom.maxLength = 4000;
  custom.setAttribute('aria-label', 'Your answer for ' + question.prompt);
  custom.hidden = true;
  custom.disabled = true;
  [...question.options, 'Type your own answer'].forEach((option, index) => {
    const label = node('label');
    const radio = node('input');
    radio.type = 'radio';
    radio.name = 'answer';
    radio.required = true;
    radio.value = String(index);
    label.append(radio, node('span', option + (index === question.recommended ? ' · Recommended' : '')));
    fields.append(label);
    radio.addEventListener('change', () => {
      const enabled = index === question.options.length;
      custom.hidden = !enabled;
      custom.disabled = !enabled;
      custom.required = enabled;
    });
  });
  fields.append(custom);
  const submit = node('button', 'Send to Cap', 'primary');
  submit.type = 'submit';
  form.append(fields, submit);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const option = Number(new FormData(form).get('answer'));
    const answer = option === question.options.length ? custom.value : option;
    decide(story.id, { type: 'answer', question: question.id, answer }, submit);
  });
  return form;
}

function renderQuestions(story) {
  const container = ui('questions');
  if (questionStory !== story.id) {
    container.replaceChildren();
    questionStory = story.id;
  }
  const existing = new Map([...container.children].map(child => [child.dataset.question, child]));
  for (const question of story.questions) {
    const previous = existing.get(question.id);
    if (previous && (previous.tagName === 'P') === Boolean(question.answer)) continue;
    const element = question.answer
      ? node('p', question.prompt + ' — ' + question.answer, 'muted multiline')
      : questionForm(story, question);
    element.dataset.question = question.id;
    if (previous) previous.replaceWith(element);
    else container.append(element);
  }
}

function renderStory(story) {
  const state = status(story);
  const phaseIndex = workflow.findIndex(([, phases]) => phases.includes(story.phase));
  ui('story-id').textContent = story.id;
  ui('story-title').textContent = story.title;
  ui('story-status').replaceChildren(node('span', state.owner + ' · ' + state.label,
    'tag' + (state.decision ? ' decision' : '') + (story.phase === 'closed' ? ' closed' : '')));
  ui('branch').textContent = story.worktree + ' / ' + story.branch;
  ui('pipeline').replaceChildren(...workflow.map(([label], index) => {
    const done = index < phaseIndex || story.phase === 'closed';
    const step = node('li', done ? '✓ ' + label : label, done ? 'done' : '');
    if (index === phaseIndex && !done) step.setAttribute('aria-current', 'step');
    return step;
  }));
  renderQuestions(story);
  ui('planning').hidden = story.phase !== 'planning' || !story.questions.length;
  ui('approval').hidden = story.phase !== 'approval' || Boolean(story.blocked);
  ui('approval-plan').textContent = story.plan ?? '';
  ui('comparison').hidden = story.phase !== 'comparison-choice' || Boolean(story.blocked);
  ui('story-brief').textContent = story.brief;
  ui('story-plan').textContent = story.plan ?? '';
  const openFiles = detailKey?.startsWith(story.id + ':')
    ? new Set([...ui('files').querySelectorAll('details[open]')].map(file => file.dataset.path)) : new Set();
  ui('changes').hidden = !story.files.length;
  ui('files').replaceChildren(...story.files.map(file => {
    const detail = node('details');
    detail.dataset.path = file.path;
    detail.open = openFiles.has(file.path);
    detail.append(node('summary', file.change + ' · ' + file.path));
    if (file.diff) detail.append(node('pre', file.diff));
    return detail;
  }));
  ui('events').replaceChildren(...story.events.map(event => {
    const row = node('li');
    const time = node('time', new Date(event.at).toLocaleTimeString());
    time.dateTime = event.at;
    const message = node('span', event.detail);
    if (typeof event.command === 'string') message.append(node('pre', event.command));
    row.append(time, message);
    return row;
  }));
  const link = ui('pull-request');
  link.hidden = !story.pr;
  if (story.pr) link.href = story.pr;
  else link.removeAttribute('href');
}

function renderAge() {
  const story = stories.find(story => story.id === selected);
  const seconds = story?.activity ? Math.max(0, Math.floor((Date.now() - Date.parse(story.activity.at)) / 1000)) : null;
  ui('activity-age').textContent = seconds === null ? 'No worker report for this phase' : 'Last worker report ' + seconds + 's ago';
  ui('pipeline').toggleAttribute('data-recent', seconds !== null && seconds < 5);
}

function render() {
  if (!stories.some(story => story.id === selected)) selected = stories[0]?.id;
  renderOverview();
  const story = stories.find(story => story.id === selected);
  ui('empty').hidden = Boolean(story);
  ui('story').hidden = !story;
  if (story) {
    renderStory(story);
    detailKey = story.id + ':' + story.revision;
    renderAge();
  }
}

async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const response = await fetch('/api/stories');
      if (!response.ok) throw new Error('Snapshot unavailable.');
      const updated = await response.json();
      if (JSON.stringify(updated.map(story => [story.id, story.revision])) !==
          JSON.stringify(stories.map(story => [story.id, story.revision]))) {
        stories = updated;
        render();
      }
      ui('connection').textContent = 'Local console';
    } catch {
      ui('connection').textContent = 'Disconnected · showing last state';
    } finally {
      refreshing = undefined;
    }
  })();
  return refreshing;
}

async function decide(id, event, button) {
  if (submitting) return;
  const story = stories.find(story => story.id === id);
  if (!story) return;
  submitting = true;
  button.disabled = true;
  ui('submit-status').textContent = '';
  try {
    const response = await fetch('/api/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ story: id, revision: story.revision, key: crypto.randomUUID(), ...event }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    ui('submit-status').textContent = 'Decision saved.';
  } catch (error) {
    ui('submit-status').textContent = error.message;
  } finally {
    await refreshing;
    await refresh();
    button.disabled = false;
    submitting = false;
  }
}

ui('stories-tab').addEventListener('click', () => { view = 'stories'; renderOverview(); });
ui('crew-tab').addEventListener('click', () => { view = 'crew'; renderOverview(); });
ui('approve').addEventListener('click', event => decide(selected, { type: 'approve' }, event.currentTarget));
ui('compare').addEventListener('click', event => decide(selected, { type: 'comparison-choice', run: true }, event.currentTarget));
ui('skip').addEventListener('click', event => decide(selected, { type: 'comparison-choice', run: false }, event.currentTarget));
await refresh();
setInterval(() => {
  renderAge();
  refresh();
}, 1500);
