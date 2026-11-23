export const approvalCurrent = { serializesStarts: true, waitsForReleasedTurns: true, checksInterruptedStarts: true, stopsDeliveredApproval: true };

export function checkApproval(fix = approvalCurrent) {
  const initial = { approved: false, pending: false, planner: true, requests: 0, procs: [], intent: false, assigned: false, everAssigned: false, spawned: 0, running: 0, blocked: false, restarted: false };
  const keyOf = state => JSON.stringify(state);
  const seen = new Map([[keyOf(initial), []]]);
  const queue = [initial];
  while (queue.length) {
    const state = queue.shift();
    const trace = seen.get(keyOf(state));
    if (state.running + Number(state.planner) > 1) return { invariant: 'OneWriterPerWorktree', trace };
    if (state.spawned > 1) return { invariant: 'OneApprovedStartup', trace };
    if (state.spawned && !state.approved) return { invariant: 'ApprovalBeforeTests', trace };
    if (state.approved && !state.pending) return { invariant: 'LaunchDoesNotAcknowledge', trace };
    const add = (label, change) => {
      const next = structuredClone(state);
      change(next);
      const key = keyOf(next);
      if (!seen.has(key)) { seen.set(key, [...trace, label]); queue.push(next); }
    };
    if (!state.approved) add('Approve', next => { next.approved = next.pending = true; });
    if (state.planner) add('ReleasedPlannerEnds', next => { next.planner = false; });
    if (state.approved && state.requests < 2 && !state.assigned && !state.blocked && (!fix.stopsDeliveredApproval || !state.everAssigned)) {
      add('RequestStart', next => {
        next.requests += 1;
        if (!fix.serializesStarts || !next.procs.length) { next.intent = true; next.procs.push('waiting'); }
      });
    }
    state.procs.forEach((proc, index) => {
      if (proc === 'waiting' && (!fix.waitsForReleasedTurns || !state.planner)) {
        add('Spawn', next => { next.procs[index] = 'spawned'; next.spawned += 1; next.running += 1; });
        add('LaunchFailure', next => { next.procs.splice(index, 1); next.blocked = true; });
      }
      if (proc === 'spawned') add('Assign', next => { next.procs.splice(index, 1); next.assigned = next.everAssigned = true; });
    });
    if (state.running) add('TestTurnEnds', next => { next.running -= 1; });
    if (state.assigned && !state.running) add('ReleaseTester', next => { next.assigned = false; });
    if (!state.restarted) add('Restart', next => {
      next.restarted = true;
      next.requests = 0;
      next.procs = [];
      if (fix.checksInterruptedStarts && next.intent && !next.everAssigned) next.blocked = true;
    });
  }
  return { states: seen.size };
}
