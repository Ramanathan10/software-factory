export const current = { filterSent: true, handReserves: true, startRegistersTurn: true, waitsForAdoptedTurns: true, recordsAtSpawn: true, rechecksAssignment: true, releasesAtTurnEnd: true };

const DECISIONS = 2;
const JARVIS_CALLS = 2;
const RESTARTS = 1;
const REPLACEMENTS = 2;

const initial = fix => ({
  restarts: 0, jarvisCalls: 0, nextId: 1, assign: 0, replaced: 0, released: 0, resumedReleased: false,
  live: Array(DECISIONS).fill(false), wasted: Array(DECISIONS).fill(false),
  recorded: Array(DECISIONS).fill(false), pending: Array(DECISIONS).fill(false),
  duplicated: false, sent: Array(DECISIONS).fill(false), batch: Array(DECISIONS).fill(false),
  procs: [],
  tails: Array(REPLACEMENTS + 1).fill(null).map((tail, session) => (session === 0 && fix.startRegistersTurn ? 0 : null)),
  turns: [{ id: 0, token: 0, session: 0, seqs: Array(DECISIONS).fill(false), known: Boolean(fix.startRegistersTurn), recorded: true }],
});

const release = (next, token, seqs) => {
  if (next.procs.some(proc => proc.token === token)) return;
  seqs.forEach((seq, d) => { if (seq && next.sent[d] === token) next.sent[d] = false; });
};

const any = seqs => seqs.some(Boolean);
const settledEntry = (state, id) => id === null || (!state.procs.some(proc => proc.id === id) && !state.turns.some(turn => turn.id === id));

function hand(state, fix, seqs, via) {
  if (state.assign === null) return null;
  const carried = fix.handReserves ? seqs.map((seq, d) => seq && !state.sent[d]) : seqs;
  if (!any(carried)) return null;
  const next = structuredClone(state);
  carried.forEach((seq, d) => {
    if (seq && (state.procs.some(proc => proc.seqs[d]) || state.turns.some(turn => turn.seqs[d] && !turn.adopted))) next.duplicated = true;
  });
  if (fix.handReserves) carried.forEach((seq, d) => { if (seq) next.sent[d] = next.nextId; });
  next.procs.push({ id: next.nextId, token: next.nextId, via, seqs: carried, session: state.assign, waitsFor: next.tails[state.assign], spawned: false });
  next.tails[state.assign] = next.nextId;
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
    const ready = !proc.spawned && settledEntry(state, proc.waitsFor) && !(fix.waitsForAdoptedTurns && state.turns.some(turn => turn.known && (!turn.adopted || turn.session === state.assign)));
    if (ready && fix.rechecksAssignment && proc.session !== state.assign) {
      step('Stale(' + proc.via + '#' + proc.id + ')', next => {
        next.procs.splice(at, 1);
        if (next.assign === null) {
          if (fix.handReserves) proc.seqs.forEach((seq, d) => { if (seq) next.sent[d] = false; });
          return;
        }
        next.procs.push({ ...proc, id: next.nextId, session: next.assign, waitsFor: next.tails[next.assign] });
        next.tails[next.assign] = next.nextId;
        next.nextId += 1;
      });
    } else if (ready) {
      step('Spawn(' + proc.via + '#' + proc.id + ')', next => {
        next.procs[at].spawned = true;
        next.turns.push({ id: proc.id, session: proc.session, seqs: proc.seqs, known: true, recorded: Boolean(fix.recordsAtSpawn), token: proc.token });
        if (proc.session !== state.assign && state.assign !== null) next.resumedReleased = true;
        proc.seqs.forEach((seq, d) => {
          if (!seq) return;
          if (proc.session === state.assign) next.live[d] = true;
          else next.wasted[d] = true;
        });
      });
    }
    if (proc.spawned) {
      step('Settled(' + proc.via + '#' + proc.id + ')', next => {
        if (!fix.handReserves) proc.seqs.forEach((seq, d) => { if (seq) next.sent[d] = true; });
        next.turns.forEach(turn => { if (turn.id === proc.id) turn.recorded = true; });
        next.procs.splice(at, 1);
        if (fix.releasesAtTurnEnd && fix.handReserves && !next.turns.some(turn => turn.id === proc.id)) release(next, proc.token, proc.seqs);
      });
    }
  }
  for (const turn of state.turns) {
    const at = state.turns.indexOf(turn);
    turn.seqs.forEach((seq, d) => {
      if (seq && state.pending[d] && turn.session === state.assign) step('Ack(d' + d + ')', next => { next.pending[d] = false; });
    });
    step('TurnEnd(#' + turn.id + ')', next => {
      next.turns.splice(at, 1);
      if (fix.releasesAtTurnEnd && fix.handReserves) release(next, turn.token, turn.seqs);
    });
  }
  if (state.assign !== null && state.released < REPLACEMENTS) {
    step('Release', next => { next.assign = null; next.released += 1; });
  }
  if (state.assign === null && state.replaced < REPLACEMENTS && !state.turns.some(turn => turn.adopted)) {
    step('Assign', next => { next.replaced += 1; next.assign = next.replaced; });
  }
  if (state.restarts < RESTARTS && state.turns.every(turn => state.assign === null || turn.session === state.assign)) {
    step('Restart', next => {
      next.restarts += 1;
      next.sent.fill(false);
      next.batch.fill(false);
      next.procs = [];
      next.tails.fill(null);
      next.turns.forEach(turn => { turn.known = turn.recorded; turn.adopted = true; });
    });
  }
  return out;
}

export const invariants = {
  OneTurnPerSession: state => new Set(state.turns.map(turn => turn.session)).size === state.turns.length,
  OneTurnPerWorktree: state => state.turns.length <= 1,
  ReleasedSessionNeverResumed: state => !state.resumedReleased,
  NoDuplicateDelivery: state => !state.duplicated,
  NeverBlocked: state => state.assign === null || state.pending.every((pending, d) => !pending || !state.sent[d] || state.procs.some(proc => proc.seqs[d]) || state.turns.some(turn => turn.seqs[d])),
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
    if (!next.length && state.pending.some((pending, d) => pending && state.wasted[d] && !state.live[d])) return { lost: true, trace: trace(key) };
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
