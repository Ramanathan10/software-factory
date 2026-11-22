// Watches every turn of every story worker, so a turn that stops is recorded even when the worker said
// nothing. The daemon is told about the turns it starts; turns left running by an earlier daemon are found
// in the store by their process ID and checked on a timer.
import { readFileSync } from 'node:fs';
import { uptime } from 'node:os';

// Whether a process with this ID exists. A process the daemon may not signal still exists.
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

// Decides what a finished turn means and whether Jarvis should be woken for it.
//   code      the program's exit code, or null when it is not known
//   recorded  how many events the worker recorded during the turn
//   adopted   true when this daemon did not start the turn and only found that its process is gone
// Returns { outcome: 'ended' | 'failed' | 'lost', wake: boolean }.
// A worker that recorded something has already told Jarvis through those events, so only a turn that
// failed, or stopped having said nothing, is news. `adopted` does not change the answer today: an unknown
// exit code is treated the same whoever started the turn.
export function turnVerdict({ code, recorded }) {
  if (code) return { outcome: 'failed', wake: true };
  const silent = recorded === 0;
  // With no exit code, what the worker recorded is the only evidence that it finished its turn.
  return { outcome: code === null && silent ? 'lost' : 'ended', wake: silent };
}

// Events the owner, Hawkeye, or the daemon records; everything else during a turn is the worker's.
const notTheWorker = new Set(['answer', 'approve', 'plan-feedback', 'comparison-choice', 'request-cleanup', 'pr-observed', 'turn-started', 'turn-ended']);

// How many events the worker recorded since its turn started. `story.events` is newest first.
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
  // Turns this daemon started and will hear the end of, as "<story>:<pid>".
  const owned = new Set();
  const find = id => service.snapshot().find(story => story.id === id);

  // Another process may record on the story between reading its revision and writing; read again and retry.
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
    // The worker was released, or a newer turn has started: this one is already accounted for.
    if (!turn || turn.pid !== pid) return;
    const recorded = recordedSince(story);
    const { outcome, wake } = verdict({ code, recorded, adopted });
    try {
      record({ story: id, type: 'turn-ended', assignment: story.worker.id, outcome, wake, code, detail: describe(outcome, code, recorded, turn.log) });
    } catch (error) {
      log('The end of a worker turn on ' + id + ' could not be recorded (' + error.message + ').');
    }
  }

  const supervisor = {
    // Called with each turn this daemon starts: `ended` resolves to the program's exit code.
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
    // Checks the turns this daemon did not start. A turn recorded before the machine last started cannot
    // still be running, whatever process now has its ID.
    sweep() {
      for (const story of service.snapshot()) {
        const turn = story.worker?.turn;
        if (!turn || owned.has(story.id + ':' + turn.pid)) continue;
        if (Date.parse(turn.at) < bootedAt || !alive(turn.pid)) finish(story.id, turn.pid, null, true);
      }
    },
    // Sweeps now and then every `pollMs`. Returns the function that stops it.
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
      return () => clearInterval(timer);
    },
  };
  return supervisor;
}
