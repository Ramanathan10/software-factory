import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { evaluate, withDefaults } from './engine.mjs';
import { trackers } from './trackers.mjs';
import { isMain } from '../mission-console/is-main.mjs';

export function checkStory({ id, repo, snapshot, testsPass }, { profile, table = trackers, run } = {}) {
  const settings = withDefaults({ repository: repo, ...profile?.repos?.[repo]?.readiness });
  if (settings.tracker === 'none') return { skipped: `No tracker is set for ${repo}, so there is no readiness check.` };
  const tracker = table[settings.tracker];
  if (!tracker) return { problem: `"${settings.tracker}" is not a known tracker. Known: ${Object.keys(table).join(', ')}.` };
  const missing = tracker.needs.filter(name => !settings[name]);
  if (missing.length) return { problem: `readiness.${missing.join(' and readiness.')} must be set for ${settings.tracker}. Run the ai-sdlc-setup skill.` };
  if (!snapshot) {
    if (tracker.reads === 'in-app') return { inApp: true, next: tracker.supply + ' Then run this again with --snapshot and that JSON on stdin.' };
    snapshot = tracker.read(id, settings, run);
  }
  if (testsPass) snapshot = { ...snapshot, testsPass: true };
  return { tracker: settings.tracker, story: snapshot.story.id, ...evaluate(snapshot, settings) };
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const id = Number(String(args[0] ?? '').replace(/^[A-Za-z][A-Za-z0-9]*-/, ''));
  const repo = value('--repo');
  if (!id || !repo) {
    console.error('Usage: node check-story.mjs <story id> --repo <owner/name> [--tests-pass] [--snapshot]   (--snapshot reads a snapshot from stdin)');
    process.exit(2);
  }
  let profile = {};
  try { profile = JSON.parse(readFileSync(join(process.env.AI_SDLC_HOME || join(homedir(), '.ai-sdlc'), 'profile.json'), 'utf8')); } catch {}
  try {
    const snapshot = args.includes('--snapshot') ? JSON.parse(readFileSync(0, 'utf8')) : undefined;
    const result = checkStory({ id, repo, snapshot, testsPass: args.includes('--tests-pass') }, { profile });
    console.log(JSON.stringify(result, null, 1));
    process.exitCode = result.problem ? 1 : 0;
  } catch (error) {
    console.error(`The story could not be read: ${error.message}`);
    process.exitCode = 1;
  }
}
