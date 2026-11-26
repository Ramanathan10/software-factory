const age = ms => {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  return minutes < 60 ? minutes + 'm' : Math.floor(minutes / 60) + 'h';
};

export function jarvisHold(story) {
  if (story.jarvis?.turn || story.jarvis?.waking) return 'checking';
  return story.waitingOnJarvis ? 'waiting' : undefined;
}

export function jarvisStatus(story, now = Date.now()) {
  if (jarvisHold(story) === 'checking') return 'Jarvis is checking';
  const waiting = story.waitingOnJarvis;
  return waiting ? ['Waiting on Jarvis', age(now - Date.parse(waiting.since)), waiting.why].join(' · ') : undefined;
}
