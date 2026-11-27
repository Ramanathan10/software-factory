export const matches = (entry, { keyword = '', story = null } = {}) => {
  if (story && entry.story !== story) return false;
  const needle = keyword.trim().toLowerCase();
  if (!needle) return true;
  return [entry.story, entry.type, entry.detail ?? ''].join(' ').toLowerCase().includes(needle);
};

export const feedEntries = (stories, filter, limit = 80) => stories
  .flatMap(story => (story.events ?? []).map(event => ({ ...event, story: story.id, title: story.title })))
  .filter(entry => matches(entry, filter))
  .sort((a, b) => b.seq - a.seq)
  .slice(0, limit);

export const freshEntries = (shown, previousMaxSeq) => previousMaxSeq === null ? [] : shown.filter(entry => entry.seq > previousMaxSeq);
