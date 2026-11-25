import { readFileSync } from 'node:fs';
import { uptime } from 'node:os';
import { row } from '../adapters/harnesses.mjs';
import { harnessKey, phases } from '../mission-console/roles.mjs';
import { isAlive } from './supervisor.mjs';

const decisions = new Set(['answer', 'approve', 'plan-feedback', 'comparison-choice', 'request-cleanup']);
const notice = 'action-jarvis-';
const choices = ['Done - Jarvis can run again', 'Hold - not now'];
const reasons = {
  'turn-ended': 'a worker turn needs a look',
  answer: 'the owner answered',
  question: 'a question was asked',
  'release-worker': 'the worker was released',
  blocked: 'the story is blocked',
};

const why = event => (event.type === 'handoff' ? 'handed off to ' + (phases[event.phase]?.[1] ?? event.phase).toLowerCase()
  : reasons[event.type] ?? event.type.replace(/-/g, ' '));

function lines(file) {
  try {
    return readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(line => line.trim()).slice(-20);
  } catch {
    return [];
  }
}

const commandLine = story => {
  try {
    return row(story.harness).workers === 'command-line';
  } catch {
    return false;
  }
};

export function createCoordinator({ service, launch, adapters, kickoff, busy = () => false, quietMs = 10000, alive = isAlive,
  bootedAt = Date.now() - uptime() * 1000, log = console.error }) {
  const waking = new Set();
  const owned = new Set();
  const wakes = new Set();
  let stopped = false;
  const find = id => service.snapshot().find(story => story.id === id);

  function record(event) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return service.recordEvent({ ...event });
      } catch (error) {
        if (attempt === 2 || error.status !== 409 || !/Story changed/.test(error.message)) throw error;
      }
    }
  }

  const answered = (story, event) => event.type === 'answer' && story.questions.some(question => question.id.startsWith(notice) && question.answer === event.detail);
  const held = (story, event) => answered(story, event) && /^Hold/.test(event.detail);

  function needs(story, pending) {
    if (story.phase === 'closed' || !commandLine(story)) return [];
    if (waking.has(story.id) || story.jarvis?.turn || story.jarvis?.waking || busy(story.id)) return [];
    if (story.questions.some(question => question.id.startsWith(notice) && !question.answer)) return [];
    const news = pending.filter(event => event.story === story.id && !['create', 'approve'].includes(event.type) && !held(story, event) &&
      (!story.worker || !decisions.has(event.type) || answered(story, event)));
    const forJarvis = event => (event.type === 'turn-ended' && event.worker?.id === story.worker.id) || answered(story, event) ||
      (event.type === 'pr-observed' && (event.feedback === true || ['merged', 'closed'].includes(event.observation?.status)));
    if (story.worker && (story.worker.turn || !unhandled(story, news).some(forJarvis))) return [];
    return news;
  }

  const unhandled = (story, news) => news.filter(event => event.seq > (story.jarvis?.handled ?? 0));

  function ask(id, seq, what) {
    const text = what.replace(/[\s.]+$/, '').slice(0, 2000);
    try {
      record({ story: id, type: 'question', question: notice + seq, by: 'jarvis', recommended: 0, options: choices,
        prompt: 'Action for you: Jarvis could not run for ' + id + ': ' + text + '. Then choose Done.' });
    } catch (error) {
      log('The Jarvis failure on ' + id + ' could not be put to the owner (' + error.message + ').');
    }
  }

  function told(story, text, fallback) {
    let known;
    try { known = row(story.harness).explain?.(text); } catch {}
    return known ? known.reason + '. ' + known.next : fallback;
  }

  function end(id, outcome, code, detail, what) {
    let ended;
    try {
      ended = record({ story: id, type: 'jarvis-turn-ended', outcome, code, detail });
    } catch (error) {
      log('The end of a Jarvis turn on ' + id + ' could not be recorded (' + error.message + ').');
      return;
    }
    if (outcome !== 'ended') ask(id, ended.seq, what);
  }

  function worked(id) {
    let recorded = false;
    for (const event of service.store.history(id)) {
      if (event.type === 'jarvis-turn-started') return recorded;
      if (event.by === 'jarvis') recorded = true;
    }
    return false;
  }

  function finish(id, pid, code, gone = false) {
    if (stopped) return;
    try {
      settle(id, pid, code, gone);
    } catch (error) {
      log('The end of a Jarvis turn on ' + id + ' could not be checked (' + error.message + ').');
    }
  }

  function settle(id, pid, code, gone) {
    const story = find(id);
    const turn = story?.jarvis?.turn;
    if (!turn || turn.pid !== pid) return;
    const outcome = code === 0 || (gone && worked(id)) ? 'ended' : code === null ? 'lost' : 'failed';
    const tail = lines(turn.log);
    const last = tail.at(-1);
    const detail = outcome === 'ended' ? 'Jarvis ended its turn.'
      : outcome === 'failed' ? 'Jarvis turn failed (exit code ' + code + ').' : 'Jarvis turn is no longer running, and how it ended is not known.';
    const fallback = outcome === 'failed'
      ? 'Jarvis stopped with an error' + (last ? ': ' + last : '') + '. See ' + turn.log
      : 'Jarvis stopped, and how its turn ended is not known. See ' + turn.log;
    end(id, outcome, code, detail + (last && outcome !== 'ended' ? '\n' + last : '') + '\nSee ' + turn.log + '.', told(story, last ?? '', fallback));
  }

  function follow(id, pid, ended) {
    const key = id + ':' + pid;
    owned.add(key);
    ended.then(code => {
      owned.delete(key);
      finish(id, pid, code);
    });
  }

  async function wake(story, news) {
    const id = story.id;
    waking.add(id);
    try {
      record({ story: id, type: 'jarvis-woken', handled: Math.max(...news.map(event => event.seq)) });
      const prompt = kickoff(story, news);
      let tracked = false;
      const onTurn = ({ session, pid, log: file, ended }) => {
        tracked = true;
        try {
          record({ story: id, type: 'jarvis-turn-started', session: session ?? story.jarvis?.session, pid, log: file });
        } catch (error) {
          log('A Jarvis turn on ' + id + ' is running but could not be recorded (' + error.message + ').');
          return;
        }
        follow(id, pid, ended);
      };
      try {
        if (story.jarvis?.session && story.jarvis.lastTurn?.outcome === 'ended') {
          const adapter = adapters.get(harnessKey(story.harness));
          if (!adapter) throw new Error(story.harness + ' has no adapter to resume the Jarvis session.');
          await adapter.messageWorker({ session: story.jarvis.session, worktree: story.worktree, prompt, phase: 'coordinator' }, { onTurn });
        } else {
          await launch({ harness: story.harness, worktree: story.worktree, prompt, phase: 'coordinator' }, { onTurn });
        }
      } catch (error) {
        if (tracked) return;
        const message = String(error.message ?? error);
        end(id, 'failed', undefined, 'Jarvis could not start.\n' + message,
          told(story, message, 'Jarvis stopped with an error: ' + message.replace(/\s*\n\s*/g, ' ')));
      }
    } catch (error) {
      log('Jarvis could not be woken for ' + id + ' (' + error.message + ').');
    } finally {
      waking.delete(id);
    }
  }

  function reconcile(story) {
    const jarvis = story.jarvis;
    if (jarvis?.waking && !jarvis.turn && !waking.has(story.id)) {
      end(story.id, 'lost', null, 'The Command Center stopped after waking Jarvis and before its turn started.',
        'the Command Center stopped before Jarvis started. Make sure the Command Center is running');
      return;
    }
    const turn = jarvis?.turn;
    const key = story.id + ':' + turn?.pid;
    if (!turn || owned.has(key)) return;
    if (alive(turn.pid) && Date.parse(turn.at) >= bootedAt) return;
    finish(story.id, turn.pid, null, true);
  }

  const coordinator = {
    notices(id, seqs) {
      const story = find(id);
      const history = service.store.history(id);
      return seqs.filter(seq => answered(story, history.find(event => event.seq === seq) ?? {}));
    },
    waiting(story) {
      let news;
      try {
        news = unhandled(story, needs(story, service.store.pendingFor(story.id)));
      } catch {
        return undefined;
      }
      return news.length ? { since: news[0].at, why: why(news.at(-1)) } : undefined;
    },
    check() {
      if (stopped) return;
      const pending = service.pending();
      for (const story of service.snapshot()) {
        if (!commandLine(story)) continue;
        for (const event of pending) if (event.story === story.id && held(story, event)) service.ack(event.seq);
        reconcile(story);
      }
      for (const story of service.snapshot()) {
        const news = needs(story, pending);
        if (!unhandled(story, news).length || Date.now() - Date.parse(story.updatedAt) < quietMs) continue;
        const pendingWake = wake(story, news);
        wakes.add(pendingWake);
        pendingWake.finally(() => wakes.delete(pendingWake));
      }
    },
    nudge() {
      setImmediate(safely);
    },
    start(pollMs = 5000) {
      safely();
      const timer = setInterval(safely, pollMs);
      timer.unref();
      return async () => {
        stopped = true;
        clearInterval(timer);
        await Promise.allSettled([...wakes]);
      };
    },
  };
  function safely() {
    try {
      coordinator.check();
    } catch (error) {
      log('Stories waiting on Jarvis could not be checked (' + error.message + ').');
    }
  }
  return coordinator;
}
