export const current = { filterSent: true, handReserves: true, startRegistersTurn: true, waitsForAdoptedTurns: true, recordsAtSpawn: true };

const DECISIONS = 2;
const JARVIS_CALLS = 2;
const RESTARTS = 1;

const initial = fix => ({
  restarts: 0, jarvisCalls: 0, nextId: 1,
  recorded: Array(DECISIONS).fill(false), pending: Array(DECISIONS).fill(false),
  handed: Array(DECISIONS).fill(0), sent: Array(DECISIONS).fill(false), batch: Array(DECISIONS).fill(false),
  procs: [],
  tail: fix.startRegistersTurn ? 0 : null,
  turns: [{ id: 0, seqs: Array(DECISIONS).fill(false), adopted: false, recorded: true }],
});

const any = seqs => seqs.some(Boolean);
const settledEntry = (state, id) => id === null || (!state.procs.some(proc => proc.id === id) && !state.turns.some(turn => turn.id === id));

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
        next.turns.push({ id: proc.id, seqs: proc.seqs, adopted: false, recorded: Boolean(fix.recordsAtSpawn) });
        proc.seqs.forEach((seq, d) => { if (seq) next.handed[d] += 1; });
      });
    }
    if (proc.spawned) {
      step('Settled(' + proc.via + '#' + proc.id + ')', next => {
        if (!fix.handReserves) proc.seqs.forEach((seq, d) => { if (seq) next.sent[d] = true; });
        next.turns.forEach(turn => { if (turn.id === proc.id) turn.recorded = true; });
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
      next.turns.forEach(turn => { turn.adopted = turn.recorded; });
    });
  }
  return out;
}

export const invariants = {
  OneTurnPerSession: state => state.turns.length <= 1,
  NoDuplicateDelivery: state => state.handed.every(count => count <= 1),
};

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
