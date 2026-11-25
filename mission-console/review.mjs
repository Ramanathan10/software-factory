const STALL_MS = 24 * 3600 * 1000;
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

function since(from, now) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(from)) / 60000));
  if (minutes < 1440) return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
  return Math.floor(minutes / 1440) + 'd ' + Math.floor((minutes % 1440) / 60) + 'h';
}

export function stalled(story, now) {
  const at = story.prObservation?.review?.lastActivityAt;
  return ['ci', 'merge'].includes(story.phase) && Boolean(at) && now - Date.parse(at) > STALL_MS;
}

export function reviewLabels(story, now) {
  const review = story.prObservation?.review;
  if (!['ci', 'merge'].includes(story.phase) || !review) return [];
  return [
    review.changesRequested.length > 0 && 'Changes requested · ' + plural(review.changesRequested.length, 'reviewer', 'reviewers'),
    review.unresolved > 0 && plural(review.unresolved, 'unresolved thread', 'unresolved threads'),
    review.earlier > 0 && 'Earlier-head feedback · ' + review.earlier,
    stalled(story, now) && 'No review activity for ' + since(review.lastActivityAt, now),
  ].filter(Boolean);
}
