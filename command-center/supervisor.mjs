import { readFileSync } from 'node:fs';
import { uptime } from 'node:os';

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function turnVerdict({ code, recorded }) {
  if (code) return { outcome: 'failed', wake: true };
  const silent = recorded === 0;
  return { outcome: code === null && silent ? 'lost' : 'ended', wake: silent };
}

const notTheWorker = new Set(['answer', 'approve', 'plan-feedback', 'comparison-choice', 'request-cleanup', 'pr-observed', 'turn-started', 'turn-ended']);

function recordedSince(story) {
  let count = 0;
  for (const event of story.events) {
    if (event.type === 'turn-started') break;
    if (!notTheWorker.has(event.type)) count += 1;
  }
  return count;
}

function tail(file) {
  try {
    return readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(-3).join('\n').slice(-600);
  } catch {
    return '';
  }
}

function describe(outcome, code, recorded, file) {
  if (outcome === 'ended') return 'Worker ended its turn.' + (recorded ? '' : ' It recorded nothing during the turn.');
  const what = outcome === 'failed'
    ? 'Worker turn failed' + (code === null ? '' : ' (exit code ' + code + ')') + '.'
    : 'Worker turn is no longer running, and how it ended is not known.';
  const last = tail(file);
  return what + (last ? '\n' + last : '') + '\nSee ' + file + '.';
}

export function createSupervisor({ service, verdict = turnVerdict, alive = isAlive, bootedAt = Date.now() - uptime() * 1000, log = console.error }) {
  const owned = new Set();
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

  function finish(id, pid, code, adopted) {
    const story = find(id);
    const turn = story?.worker?.turn;
    if (!turn || turn.pid !== pid) return;
    const recorded = recordedSince(story);
    const { outcome, wake } = verdict({ code, recorded, adopted });
    try {
      record({ story: id, type: 'turn-ended', assignment: story.worker.id, outcome, wake, code, detail: describe(outcome, code, recorded, turn.log) });
    } catch (error) {
      log('The end of a worker turn on ' + id + ' could not be recorded (' + error.message + ').');
    }
  }

  const adopted = (id, turn) => turn && !owned.has(id + ':' + turn.pid) && Date.parse(turn.at) >= bootedAt && alive(turn.pid);

  const waits = new Map();

  const supervisor = {
    track({ story, pid, log: file, ended }) {
      const assignment = find(story)?.worker?.id;
      try {
        if (!assignment) throw new Error('no worker is assigned');
        record({ story, type: 'turn-started', assignment, pid, log: file });
      } catch (error) {
        log('A worker turn on ' + story + ' is running but could not be recorded (' + error.message + ').');
        return;
      }
      const key = story + ':' + pid;
      owned.add(key);
      ended.then(code => {
        owned.delete(key);
        finish(story, pid, code, false);
      });
    },
    sweep() {
      for (const story of service.snapshot()) {
        const turn = story.worker?.turn;
        if (!turn || owned.has(story.id + ':' + turn.pid)) continue;
        if (!adopted(story.id, turn)) finish(story.id, turn.pid, null, true);
      }
    },
    idle(id, pollMs = 1000) {
      return new Promise((resolve, reject) => {
        const check = () => {
          waits.delete(check);
          if (!adopted(id, find(id)?.worker?.turn)) return resolve();
          waits.set(check, { timer: setTimeout(check, pollMs), reject });
        };
        check();
      });
    },
    start(pollMs = 5000) {
      const safely = () => {
        try {
          supervisor.sweep();
        } catch (error) {
          log('Worker turns could not be checked (' + error.message + ').');
        }
      };
      safely();
      const timer = setInterval(safely, pollMs);
      timer.unref();
      return () => {
        clearInterval(timer);
        for (const { timer: wait, reject } of waits.values()) {
          clearTimeout(wait);
          reject(new Error('The Command Center stopped before the earlier turn ended.'));
        }
        waits.clear();
      };
    },
  };
  return supervisor;
}
