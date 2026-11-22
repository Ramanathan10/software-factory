// Works out what has started waiting on the owner since the last frame, so each thing is announced once.
// `waiting` holds one { key, ... } for everything waiting now. `seen` is the set of keys from the frame
// before, or null on the first frame, when nothing counts as new: opening the page announces nothing.
export function newlyWaiting(seen, waiting) {
  return { seen: new Set(waiting.map(item => item.key)), fresh: seen ? waiting.filter(item => !seen.has(item.key)) : [] };
}

// The browser tab's title, with the number of stories waiting on the owner in front when there are any.
export const titleFor = (count, name = 'AI SDLC Command Center') => (count ? '(' + count + ') ' : '') + name;
