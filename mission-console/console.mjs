import { harnessKey, lanes, phases, roles } from './roles.mjs';

const ui = id => document.getElementById(id);
const workflow = lanes(phases, 3).map(lane => [lane.name, lane.phases]);
const planPhases = new Set(Object.keys(phases).slice(Object.keys(phases).indexOf('approval')));
let stories = [];
let selected;
let view = 'stories';
let refreshing;
let submitting = false;
let questionStory;
let detailKey;
let evidenceKey;
let storyTab = 'overview';
let planKey;

const observations = {
  failed: 'CI failed', passed: 'Reported checks passed', running: 'Checks still running',
  'no-checks': 'No checks reported', merged: 'Merge observed', closed: 'PR closed without merge',
};

function node(tag, text, classes) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (classes) element.className = classes;
  return element;
}

function roleLabel(id) {
  const role = roles[id];
  return role.alias + ' · ' + role.job;
}

function filterKey(story) {
  return 'harness:' + harnessKey(story.harness);
}

function updateHarnessFilter() {
  const select = ui('harness-filter');
  const selectedKey = select.value;
  const options = new Map([['', 'All harnesses']]);
  for (const story of stories) options.set(filterKey(story), story.harness ?? 'Harness not recorded');
  const signature = JSON.stringify([...options]);
  if (select.dataset.options === signature) return;
  select.replaceChildren(...[...options].map(([key, name]) => {
    const option = node('option', name);
    option.value = key;
    return option;
  }));
  select.dataset.options = signature;
  select.value = options.has(selectedKey) ? selectedKey : '';
}

function visibleStories() {
  const filter = ui('harness-filter').value;
  return filter ? stories.filter(story => filterKey(story) === filter) : stories;
}

function waitingForJarvis(story) {
  return Boolean(story?.pendingDecision);
}

function status(story) {
  if (story.cleanup) return { owner: 'coordinator', label: story.cleanup.blocked ? 'Cleanup blocked' : 'Cleanup queued', alert: true };
  if (['ci', 'merge'].includes(story.phase) && story.prObservation?.status === 'merged') {
    return { owner: 'watcher', label: 'Merge observed · awaiting story closure' };
  }
  if (story.phase === 'closed') return { owner: 'coordinator', label: 'Merged' };
  if (story.phase === 'planning' && story.questions.some(question => !question.answer)) {
    return { owner: 'planner', label: 'Answer Captain America', decision: true };
  }
  if (story.blocked) return { owner: phases[story.phase][0], label: 'Blocked' };
  const [owner, label] = phases[story.phase];
  if (waitingForJarvis(story)) return { owner, label: 'Decision saved · waiting for Jarvis', alert: true };
  const signal = story.prObservation?.status;
  if (['ci', 'merge'].includes(story.phase) && signal) {
    if (story.phase === 'merge' && story.readyHead === story.prObservation.head && signal === 'passed') {
      return { owner, label };
    }
    const awaitingReview = story.phase === 'merge' && signal === 'passed';
    return { owner, label: awaitingReview ? 'Checks passed · readiness needs confirmation' : observations[signal] ?? label,
      alert: ['failed', 'closed'].includes(signal) };
  }
  return { owner, label, decision: owner === 'approver' };
}

function storyButton(story, showOwner, showActivity = false) {
  const state = status(story);
  const button = node('button');
  button.type = 'button';
  button.setAttribute('aria-pressed', String(story.id === selected));
  button.append(node('span', story.id + ' · ' + story.title));
  button.append(node('span', (showOwner ? roleLabel(state.owner) + ' · ' : '') + state.label +
    (story.harness ? ' · ' + story.harness : ''), state.alert ? 'attention-text' : 'muted'));
  if (showActivity) {
    const latest = story.events[0];
    if (latest) button.append(node('span', latest.detail, 'crew-detail'));
    const age = node('span', '', 'muted crew-age');
    age.dataset.storyAge = story.id;
    button.append(age);
  }
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
  const visible = visibleStories();
  const decisions = visible.filter(story => status(story).decision);
  ui('attention').replaceChildren(...(decisions.length
    ? decisions.map(story => storyButton(story, false))
    : [node('p', 'No decisions waiting.', 'muted')]));
  ui('overview-title').textContent = view === 'stories' ? 'Stories' : 'Crew';
  ui('stories-tab').setAttribute('aria-pressed', String(view === 'stories'));
  ui('crew-tab').setAttribute('aria-pressed', String(view === 'crew'));
  if (view === 'stories') {
    ui('overview').replaceChildren(...visible.map(story => storyButton(story, true)));
  } else {
    const groups = Object.entries(roles).map(([id, role]) => {
      const assignments = visible.filter(story => (story.phase !== 'closed' || story.cleanup) && status(story).owner === id);
      const group = node('section', '', 'panel crew-role' + (assignments.length ? ' has-assignments' : ''));
      group.append(node('h3', roleLabel(id)), node('p', assignments.length ? assignments.length + ' assigned' : 'No active assignment', 'muted'));
      if (role.skills.length) {
        const skills = node('ul', '', 'role-skills');
        skills.append(...role.skills.map(skill => node('li', skill)));
        group.append(skills);
      } else {
        group.append(node('p', 'Plan approval and workflow decisions', 'muted'));
      }
      group.append(...assignments.map(story => storyButton(story, false, true)));
      return { group, count: assignments.length };
    }).sort((a, b) => b.count - a.count);
    ui('overview').replaceChildren(...groups.map(({ group }) => group));
    renderAge();
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
  const submit = node('button', 'Send answer', 'primary');
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
  const steps = [...workflow];
  const phaseIndex = steps.findIndex(([, phases]) => phases.includes(story.phase));
  ui('story-id').textContent = story.id;
  ui('story-title').textContent = story.title;
  ui('story-status').replaceChildren(node('span', roleLabel(state.owner) + ' · ' + state.label,
    'tag' + (state.decision || state.alert ? ' decision' : '') + (story.phase === 'closed' ? ' closed' : '')));
  const harness = story.harness ?? (story.phase === 'closed' ? 'Harness not recorded' : 'Harness selection required');
  ui('story-status').append(node('span', ' · ' + harness, 'muted'));
  const round = ['review', 'building'].includes(story.phase) && story.reviewRounds ? ' · Review round ' + (story.reviewRounds + 1) : '';
  ui('story-skills').textContent = roles[state.owner].skills.join(' · ') + round;
  ui('current-assignment').textContent = story.worker
    ? roleLabel(roles[story.worker.role] ? story.worker.role : phases[story.phase][0]) +
      (story.cleanup ? ' must be stopped and released for cleanup.' : ' has the current assignment.') + ' Session ' + story.worker.session + '.'
    : story.phase === 'diagram' ? 'Rocket is awaiting assignment.' : '';
  ui('branch').textContent = story.worktree + ' / ' + story.branch;
  renderEvidence(story);
  renderPlanTab(story);
  ui('delete-story').hidden = Boolean(story.cleanup);
  if (!detailKey?.startsWith(story.id + ':') || story.cleanup) ui('delete-story').open = false;
  ui('pipeline').replaceChildren(...steps.map(([label, phases], index) => {
    const latestReplan = story.events.find(event => event.type === 'replan')?.seq ?? 0;
    const comparisonChoice = story.events.find(event => event.type === 'comparison-choice' && event.seq > latestReplan);
    const comparisonRequested = story.comparisonRequested ?? (comparisonChoice
      ? comparisonChoice.detail === 'Before-and-after requested.' : undefined);
    const isComparison = phases.includes('comparison');
    const skipped = isComparison && comparisonRequested === false;
    const reached = index < phaseIndex || story.phase === 'closed';
    const unknown = isComparison && reached && comparisonRequested === undefined;
    const done = phases.includes('diagram') ? Boolean(story.diagram?.completedAt) : reached && !skipped && !unknown;
    const step = node('li', '', done ? 'done' : '');
    step.append(node('span', skipped ? label + ' · skipped' : unknown ? label + ' · not recorded' : done ? '✓ ' + label : label));
    if (phases.includes('diagram') && !story.diagram) {
      step.append(node('small', story.phase === 'closed' ? 'No diagram recorded' : 'Rocket · when needed'));
    }
    if (index === phaseIndex && !done) {
      step.setAttribute('aria-current', 'step');
      step.append(node('small', state.decision ? 'Your decision' : waitingForJarvis(story) ? 'Handoff queued' : roles[state.owner].alias));
    }
    return step;
  }));
  renderQuestions(story);
  ui('planning').hidden = story.phase !== 'planning' || !story.questions.length || Boolean(story.cleanup);
  ui('approval').hidden = story.phase !== 'approval' || Boolean(story.blocked || story.cleanup);
  ui('decision-handoff').hidden = !waitingForJarvis(story) && !story.cleanup;
  ui('handoff-title').textContent = story.cleanup
    ? story.cleanup.blocked ? 'Cleanup blocked · ' + story.cleanup.blocked : 'Cleanup queued for Jarvis'
    : 'Decision saved · waiting for Jarvis';
  ui('resume-prompt').textContent = 'Resume Mission Console story ' + story.id +
    (story.cleanup ? ' and carry out the verified cleanup I requested.' : ' and pick up my saved decision.');
  ui('comparison').hidden = story.phase !== 'comparison-choice' || Boolean(story.blocked || story.cleanup);
  ui('story-brief').textContent = story.brief;
  const answers = story.questions.filter(question => question.answer);
  if (story.phase === 'planning') {
    ui('plan-title').textContent = story.draftPlan || !story.plan ? 'Working plan' : 'Previous plan';
    ui('story-plan').textContent = story.draftPlan?.text ?? story.plan ?? 'Captain America has not recorded a draft yet.';
    ui('plan-status').textContent = story.draftPlan
      ? (story.draftPlan.answers < answers.length ? 'New decisions saved below. Waiting for the next draft.' : 'Draft updated ' + new Date(story.draftPlan.at).toLocaleTimeString() + '.')
      : story.plan ? 'Replanning in progress.' : '';
  } else {
    ui('plan-title').textContent = story.phase === 'approval' ? 'Proposed plan' : 'Approved plan';
    ui('story-plan').textContent = story.plan ?? '';
    ui('plan-status').textContent = '';
  }
  ui('plan-decisions').hidden = !answers.length;
  ui('decision-list').replaceChildren(...answers.flatMap(question => [
    node('dt', question.prompt), node('dd', question.answer, 'multiline'),
  ]));
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

function renderEvidence(story) {
  const artifacts = story.artifacts ?? [];
  const key = JSON.stringify([story.id, artifacts]);
  if (key === evidenceKey) return;
  evidenceKey = key;
  ui('evidence-empty').hidden = Boolean(artifacts.length);
  ui('evidence-gallery').replaceChildren(...artifacts.map(artifact => {
    const figure = node('figure');
    const url = '/api/media?' + new URLSearchParams({ story: story.id, id: artifact.id });
    const video = /\.(mp4|webm)$/i.test(artifact.path);
    const media = node(video ? 'video' : artifact.kind === 'document' ? 'span' : 'img');
    media.src = url;
    if (video) {
      media.controls = true;
      media.preload = 'metadata';
      media.setAttribute('aria-label', artifact.caption);
    } else {
      media.alt = artifact.caption;
      media.loading = 'lazy';
    }
    const label = { before: 'Before', after: 'After', diagram: 'Architecture diagram', recording: 'Recording', document: 'Document' }[artifact.kind];
    if (artifact.kind === 'document') {
      const item = node('figure');
      const open = node('a', 'Open ' + artifact.path.split(/[\\/]/).pop());
      open.href = url;
      open.target = '_blank';
      open.rel = 'noopener';
      item.append(node('figcaption', label + ' · ' + artifact.caption), open);
      return item;
    }
    figure.append(node('figcaption', label + ' · ' + artifact.caption), media);
    const link = node('a', 'Open capture');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';
    figure.append(link);
    media.addEventListener('error', () => {
      const error = node('p', 'Capture unavailable or changed. Ask the assigned worker to register it again.', 'attention-text');
      media.replaceWith(error);
    }, { once: true });
    return figure;
  }));
}

function inline(parent, text) {
  text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).forEach(part => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) parent.append(node('code', part.slice(1, -1)));
    else if (part.startsWith('**') && part.endsWith('**') && part.length > 4) parent.append(node('strong', part.slice(2, -2)));
    else if (part) parent.append(part);
  });
}

function renderMarkdown(container, text) {
  const blocks = [];
  let list;
  let fence;
  let paragraph;
  const flush = () => { paragraph = undefined; };
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('```')) {
      if (fence) { blocks.push(fence); fence = undefined; } else { fence = node('pre'); flush(); list = undefined; }
      continue;
    }
    if (fence) { fence.textContent += (fence.textContent ? '\n' : '') + line; continue; }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const item = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (heading) { flush(); list = undefined; const h = node('h' + (heading[1].length + 3)); inline(h, heading[2]); blocks.push(h); }
    else if (item) {
      flush();
      if (!list) { list = node('ul'); blocks.push(list); }
      const li = node('li');
      inline(li, item[1]);
      list.append(li);
    } else if (!line.trim()) { flush(); list = undefined; }
    else {
      list = undefined;
      if (!paragraph) { paragraph = node('p'); blocks.push(paragraph); } else paragraph.append(' ');
      inline(paragraph, line);
    }
  }
  if (fence) blocks.push(fence);
  container.replaceChildren(...blocks);
}

function planDocument(story) {
  const documents = (story.artifacts ?? []).filter(artifact => artifact.kind === 'document' && /\.md$/i.test(artifact.path));
  return documents.findLast(artifact => /design/i.test(artifact.path.split(/[\\/]/).pop()));
}

async function renderPlanTab(story) {
  const available = planPhases.has(story.phase) && Boolean(story.plan || planDocument(story));
  ui('story-tabs').hidden = !available;
  if (!available) storyTab = 'overview';
  ui('overview-tab').setAttribute('aria-pressed', String(storyTab === 'overview'));
  ui('plan-tab').setAttribute('aria-pressed', String(storyTab === 'plan'));
  ui('plan-view').hidden = storyTab !== 'plan';
  ui('story-main').hidden = storyTab === 'plan';
  if (storyTab !== 'plan') return;
  const document = planDocument(story);
  const key = JSON.stringify([story.id, story.revision, document?.id, document?.mtimeMs]);
  if (key === planKey) return;
  planKey = key;
  let text = story.plan ?? '';
  ui('plan-source').textContent = document ? 'Preserved design · ' + document.path : 'Approved plan recorded in the story (no design file registered).';
  if (document) {
    try {
      const response = await fetch('/api/media?' + new URLSearchParams({ story: story.id, id: document.id }));
      if (!response.ok) throw new Error();
      text = await response.text();
    } catch {
      ui('plan-source').textContent = 'The preserved design is unavailable or changed. Showing the plan recorded in the story.';
    }
  }
  renderMarkdown(ui('plan-rendered'), text);
}

function activityAge(story) {
  if (story?.cleanup) return { recentlyReported: false, label: 'Story work paused for cleanup' };
  const seconds = story?.activity ? Math.max(0, Math.floor((Date.now() - Date.parse(story.activity.at)) / 1000)) : null;
  const waiting = waitingForJarvis(story);
  const recentlyReported = seconds !== null && seconds < 8 && !waiting && !status(story).decision;
  const label = waiting ? 'Decision queued for Jarvis' : seconds === null ? 'No worker report for this phase'
    : 'Last worker report ' + (seconds < 60 ? seconds + 's' : Math.floor(seconds / 60) + 'm') + ' ago';
  return { recentlyReported, label };
}

function renderAge() {
  const current = activityAge(stories.find(story => story.id === selected));
  ui('activity-age').textContent = current.label;
  ui('pipeline').toggleAttribute('data-recent', current.recentlyReported);
  document.querySelectorAll('[data-story-age]').forEach(element => {
    const age = activityAge(stories.find(story => story.id === element.dataset.storyAge));
    element.textContent = age.label;
    element.toggleAttribute('data-recent', age.recentlyReported);
  });
}

function render() {
  updateHarnessFilter();
  const visible = visibleStories();
  if (!visible.some(story => story.id === selected)) selected = visible[0]?.id;
  renderOverview();
  const story = visible.find(story => story.id === selected);
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
      const signature = records => JSON.stringify(records.map(story => [story.id, story.revision, story.pendingDecision?.seq]));
      if (signature(updated) !== signature(stories)) {
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
    ui('submit-status').textContent = event.type === 'request-cleanup' ? 'Cleanup requested.' : 'Decision saved.';
  } catch (error) {
    ui('submit-status').textContent = error.message;
  } finally {
    await refreshing;
    await refresh();
    button.disabled = false;
    submitting = false;
  }
}

ui('overview-tab').addEventListener('click', () => { storyTab = 'overview'; render(); });
ui('plan-tab').addEventListener('click', () => { storyTab = 'plan'; planKey = undefined; render(); });
ui('stories-tab').addEventListener('click', () => { view = 'stories'; renderOverview(); });
ui('crew-tab').addEventListener('click', () => { view = 'crew'; renderOverview(); });
ui('harness-filter').addEventListener('change', () => {
  ui('submit-status').textContent = '';
  render();
});
ui('approve').addEventListener('click', event => decide(selected, { type: 'approve' }, event.currentTarget));
ui('compare').addEventListener('click', event => decide(selected, { type: 'comparison-choice', run: true }, event.currentTarget));
ui('skip').addEventListener('click', event => decide(selected, { type: 'comparison-choice', run: false }, event.currentTarget));
ui('confirm-cleanup').addEventListener('click', event => decide(selected, { type: 'request-cleanup' }, event.currentTarget));
ui('copy-resume').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(ui('resume-prompt').textContent);
    ui('submit-status').textContent = 'Resume message copied.';
  } catch {
    ui('submit-status').textContent = 'Select and copy the resume message above the button.';
  }
});
await refresh();
setInterval(() => {
  renderAge();
  refresh();
}, 1500);
