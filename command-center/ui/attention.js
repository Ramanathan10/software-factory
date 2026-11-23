export function newlyWaiting(seen, waiting) {
  return { seen: new Set(waiting.map(item => item.key)), fresh: seen ? waiting.filter(item => !seen.has(item.key)) : [] };
}

export const titleFor = (count, name = 'AI SDLC Command Center') => (count ? '(' + count + ') ' : '') + name;
