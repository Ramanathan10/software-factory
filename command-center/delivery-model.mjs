// A model of how the owner's decisions reach a story's worker session, checked over every interleaving of its
// steps. Each step is code that runs without an `await` in between, so the model interleaves exactly where
// the real code can be interleaved. See .claude/skills/verify-decision-delivery/SKILL.md.
//
// Step               Code
// Record             console-service.mjs  /api/decision → recordEvent, notify queues the decision in `batches`
// BatchFire          console-service.mjs  notify's timer calls `hand` with the batch
// JarvisDeliver      console-service.mjs  deliverPending (`serve.mjs deliver`) filters the pending decisions, calls `hand`
// Hand               console-service.mjs  hand, up to `await onDecision`; harnesses.mjs messageWorker up to `await previous`
// Spawn              harnesses.mjs        messageWorker spawns the turn, and it is handed the decisions in its prompt
// Settled            console-service.mjs  onDecision resolves to 'worker' once the turn is running; hand marks `sent`
// Ack                the worker records `ack` on the store for a decision it acted on
// TurnEnd            the harness program exits; its entry in harnesses.mjs `turns` resolves
// Restart            the daemon stops and starts again: `sent`, `batches` and `turns` are gone, turns keep running
//
// `fix` names the behaviors that differ between versions of the code, so a past version can be replayed.
export const current = { filterSent: true, handReserves: true, startRegistersTurn: true, waitsForAdoptedTurns: true };

const DECISIONS = 2;
const JARVIS_CALLS = 2;
const RESTARTS = 1;

const initial = fix => ({
  restarts: 0, jarvisCalls: 0, nextId: 1,
  recorded: Array(DECISIONS).fill(false), pending: Array(DECISIONS).fill(false),
  handed: Array(DECISIONS).fill(0), sent: Array(DECISIONS).fill(false), batch: Array(DECISIONS).fill(false),
  // Calls of `hand` that have not resolved: `waitsFor` is the `turns` entry messageWorker awaits.
  procs: [],
  // The session's entry in `turns`: the id of the call or turn the next message waits for.
  tail: fix.startRegistersTurn ? 0 : null,
  // Running turns of the session. Turn 0 is the kickoff turn startWorker began.
  turns: [{ id: 0, seqs: Array(DECISIONS).fill(false), adopted: false }],
});

const any = seqs => seqs.some(Boolean);
const settledEntry = (state, id) => id === null || (!state.procs.some(proc => proc.id === id) && !state.turns.some(turn => turn.id === id));

// `hand` up to its first await: which decisions this call carries, and messageWorker taking its place in `turns`.
function hand(state, fix, seqs, via) {
  const carried = fix.handReserves ? seqs.map((seq, d) => seq && !state.sent[d]) : seqs;
  if (!any(carried)) return null;
  const next = structuredClone(state);
  if (fix.handReserves) carried.forEach((seq, d) => { if (seq) next.sent[d] = true; });
  next.procs.push({ id: next.nextId, via, seqs: carried, waitsFor: next.tail, spawned: false });
  next.tail = next.nextId;
  next.nextId += 1;
  return next;
}

// Every step enabled in `state`, as [label, next state].
export function steps(state, fix) {
  const out = [];
  const step = (label, change) => {
    const next = structuredClone(state);
    if (change(next) !== false) out.push([label, next]);
  };
  for (let d = 0; d < DECISIONS; d += 1) {
    if (!state.recorded[d]) step('Record(d' + d + ')', next => { next.recorded[d] = next.pending[d] = next.batch[d] = true; });
  }
  if (any(state.batch)) {
    const next = hand({ ...structuredClone(state), batch: Array(DECISIONS).fill(false) }, fix, state.batch, 'batch');
    if (next) out.push(['BatchFire', next]);
    else step('BatchFire', next => { next.batch.fill(false); });
  }
  if (state.jarvisCalls < JARVIS_CALLS) {
    const wanted = state.pending.map((pending, d) => pending && (!fix.filterSent || !state.sent[d]));
    const next = hand({ ...structuredClone(state), jarvisCalls: state.jarvisCalls + 1 }, fix, wanted, 'jarvis');
    if (next) out.push(['JarvisDeliver', next]);
  }
  for (const proc of state.procs) {
    const at = state.procs.indexOf(proc);
    const adoptedRunning = state.turns.some(turn => turn.adopted);
    if (!proc.spawned && settledEntry(state, proc.waitsFor) && !(fix.waitsForAdoptedTurns && adoptedRunning)) {
      step('Spawn(' + proc.via + '#' + proc.id + ')', next => {
        next.procs[at].spawned = true;
        next.turns.push({ id: proc.id, seqs: proc.seqs, adopted: false });
        proc.seqs.forEach((seq, d) => { if (seq) next.handed[d] += 1; });
      });
    }
    if (proc.spawned) {
      step('Settled(' + proc.via + '#' + proc.id + ')', next => {
        if (!fix.handReserves) proc.seqs.forEach((seq, d) => { if (seq) next.sent[d] = true; });
        next.procs.splice(at, 1);
      });
    }
  }
  for (const turn of state.turns) {
    const at = state.turns.indexOf(turn);
    turn.seqs.forEach((seq, d) => {
      if (seq && state.pending[d]) step('Ack(d' + d + ')', next => { next.pending[d] = false; });
    });
    step('TurnEnd(#' + turn.id + ')', next => { next.turns.splice(at, 1); });
  }
  if (state.restarts < RESTARTS) {
    step('Restart', next => {
      next.restarts += 1;
      next.sent.fill(false);
      next.batch.fill(false);
      next.handed.fill(0);
      next.procs = [];
      next.tail = null;
      next.turns.forEach(turn => { turn.adopted = true; });
    });
  }
  return out;
}

export const invariants = {
  // Two turns of one session at once: two programs resume the same conversation and race on its worktree.
  OneTurnPerSession: state => state.turns.length <= 1,
  // A decision handed twice by one daemon: the worker acts on the owner's answer twice.
  NoDuplicateDelivery: state => state.handed.every(count => count <= 1),
};

// Breadth-first search, so each trace is a shortest one. Returns the first violation of one of `names` as
// { invariant, trace }, a state where a call of `hand` can never finish as { stuck, trace }, or { states }
// when every reachable state holds.
export function check(fix = current, names = Object.keys(invariants)) {
  const start = initial(fix);
  const seen = new Map([[JSON.stringify(start), null]]);
  const queue = [start];
  const trace = key => {
    const labels = [];
    for (let at = seen.get(key); at; at = seen.get(at.from)) labels.unshift(at.label);
    return labels;
  };
  while (queue.length) {
    const state = queue.shift();
    const key = JSON.stringify(state);
    for (const name of names) if (!invariants[name](state)) return { invariant: name, trace: trace(key) };
    const next = steps(state, fix);
    if (!next.length && state.procs.length) return { stuck: true, trace: trace(key) };
    for (const [label, after] of next) {
      const afterKey = JSON.stringify(after);
      if (!seen.has(afterKey)) {
        seen.set(afterKey, { from: key, label });
        queue.push(after);
      }
    }
  }
  return { states: seen.size };
}
