import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { isMain } from '../mission-console/is-main.mjs';

const booleans = new Set(['draft', 'fill', 'fill-first', 'fill-verbose', 'web', 'dry-run', 'no-maintainer-edit']);
const short = { t: 'title', b: 'body', F: 'body-file', B: 'base', H: 'head', d: 'draft', R: 'repo', f: 'fill', w: 'web', q: 'jq', s: 'state', L: 'limit' };

export function parse(args) {
  const values = {};
  const positionals = [];
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at];
    const long = /^--([^=]+)(?:=(.*))?$/s.exec(arg);
    const name = long ? long[1] : /^-([A-Za-z])$/.test(arg) ? short[arg[1]] ?? arg[1] : null;
    if (!name) positionals.push(arg);
    else if (long?.[2] !== undefined) values[name] = long[2];
    else if (booleans.has(name)) values[name] = true;
    else values[name] = args[(at += 1)];
  }
  return { values, positionals };
}

function git(cwd, ...args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

class Refusal extends Error {}

export const localPath = path => typeof path === 'string' && isAbsolute(path) && !/^[\\/]{2}/.test(path);

export function gh(state, args, { cwd = process.cwd(), stdin = () => readFileSync(0, 'utf8') } = {}) {
  mkdirSync(state, { recursive: true });
  appendFileSync(join(state, 'calls.log'), JSON.stringify({ at: new Date().toISOString(), cwd, args }) + '\n');
  const file = join(state, 'pulls.json');
  const pulls = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  const save = () => writeFileSync(file, JSON.stringify(pulls, null, 2));
  const [group, command, ...rest] = args;
  const { values, positionals } = parse(rest);
  const origin = git(cwd, 'remote', 'get-url', 'origin');
  const slug = /[/:]([^/:]+\/[^/]+?)(?:\.git)?$/.exec(origin)?.[1];
  const branch = () => git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD');
  const headOf = pull => (localPath(pull.origin) && git(cwd, 'ls-remote', pull.origin, 'refs/heads/' + pull.head).split(/\s/)[0]) || pull.headAtOpen;
  const find = target => {
    const wanted = String(target ?? branch()).replace(/\/$/, '').replace(/^#/, '');
    const pull = pulls.find(item => item.url === wanted || String(item.number) === wanted || item.head === wanted);
    if (!pull) throw new Refusal('no pull requests found for branch "' + wanted + '"');
    return pull;
  };
  const fields = pull => ({
    number: pull.number, url: pull.url, title: pull.title, body: pull.body, state: pull.state, isDraft: pull.draft,
    baseRefName: pull.base, headRefName: pull.head, headRefOid: headOf(pull), statusCheckRollup: pull.checks ?? [],
    comments: pull.comments, reviews: [], reviewDecision: '', mergeable: pull.mergeable ?? 'MERGEABLE', mergeStateStatus: pull.mergeStateStatus ?? 'CLEAN',
  });
  const pick = pull => {
    const all = fields(pull);
    return Object.fromEntries(String(values.json).split(',').map(name => [name, all[name] ?? null]));
  };
  const bodyFrom = () => (values['body-file'] === undefined ? values.body : values['body-file'] === '-' ? stdin() : readFileSync(resolve(cwd, values['body-file']), 'utf8'));
  const needsRepository = () => {
    if (!slug) throw new Refusal('none of the git remotes configured for this repository point to a known GitHub host.');
    if (!localPath(origin)) throw new Refusal('The end-to-end gh stand-in works only with a local origin, and this repository\'s origin is ' + origin + '. It never contacts a remote host.');
  };

  if (args[0] === '--version') return 'gh version 0.0.0-e2e (stand-in for an end-to-end check)';
  if (group === 'auth' && command === 'status') return 'github.com\n  Logged in to github.com account e2e-owner (stand-in for an end-to-end check)';
  if (group === 'repo' && command === 'view') {
    needsRepository();
    const repo = { name: slug.split('/')[1], nameWithOwner: slug, owner: { login: slug.split('/')[0] }, url: 'https://github.com/' + slug, defaultBranchRef: { name: 'main' } };
    return values.json ? JSON.stringify(Object.fromEntries(String(values.json).split(',').map(name => [name, repo[name] ?? null]))) : slug;
  }
  if (group === 'pr' && command === 'create') {
    needsRepository();
    if (values.web) throw new Refusal('the stand-in cannot open a browser; pass --title and --body.');
    const head = values.head ?? branch();
    const base = values.base ?? 'main';
    const pushed = git(cwd, 'ls-remote', origin, 'refs/heads/' + head).split(/\s/)[0];
    if (!pushed) throw new Refusal('aborted: you must first push the current branch to a remote, or use the --head flag');
    const open = pulls.find(item => item.head === head && item.state === 'OPEN');
    if (open) throw new Refusal('a pull request for branch "' + head + '" into branch "' + base + '" already exists:\n' + open.url);
    const filled = values.fill || values['fill-first'] || values['fill-verbose'];
    const title = values.title ?? (filled ? git(cwd, 'log', '-1', '--format=%s') : undefined);
    const body = bodyFrom() ?? (filled ? git(cwd, 'log', '-1', '--format=%b') : undefined);
    if (!title || body === undefined) throw new Refusal('must provide `--title` and `--body` (or `--fill`) when not running interactively');
    const number = pulls.length + 1;
    const pull = { number, url: 'https://github.com/' + slug + '/pull/' + number, title, body, base, head, headAtOpen: pushed, draft: Boolean(values.draft), state: 'OPEN', origin, comments: [] };
    pulls.push(pull);
    save();
    return pull.url;
  }
  if (group === 'pr' && command === 'view') {
    const pull = find(positionals[0]);
    return values.json ? JSON.stringify(pick(pull)) : [pull.title + ' #' + pull.number, 'state: ' + pull.state, pull.url, '', pull.body].join('\n');
  }
  if (group === 'pr' && command === 'list') {
    const listed = pulls.filter(item => (!values.head || item.head === values.head) && (!values.state || values.state === 'all' || item.state === values.state.toUpperCase()));
    return values.json ? JSON.stringify(listed.map(pick)) : listed.map(item => item.number + '\t' + item.title + '\t' + item.head + '\t' + item.state).join('\n');
  }
  if (group === 'pr' && command === 'edit') {
    const pull = find(positionals[0]);
    const body = bodyFrom();
    if (values.title !== undefined) pull.title = values.title;
    if (body !== undefined) pull.body = body;
    if (values.base !== undefined) pull.base = values.base;
    save();
    return pull.url;
  }
  if (group === 'pr' && command === 'comment') {
    const pull = find(positionals[0]);
    pull.comments.push({ body: bodyFrom() ?? '' });
    save();
    return pull.url + '#issuecomment-' + pull.comments.length;
  }
  if (group === 'pr' && command === 'merge') {
    const pull = find(positionals[0]);
    if (pull.state !== 'OPEN') throw new Refusal('Pull request #' + pull.number + ' is already ' + pull.state.toLowerCase() + '.');
    pull.state = 'MERGED';
    save();
    return 'Merged pull request #' + pull.number;
  }
  if (group === 'pr' && command === 'checks') {
    throw new Refusal("no checks reported on the '" + find(positionals[0]).head + "' branch");
  }
  throw new Refusal('The end-to-end gh stand-in does not support "gh ' + args.join(' ') + '". It records pull requests for a local origin and cannot reach GitHub.');
}

if (isMain(import.meta.url)) {
  const [state, ...args] = process.argv.slice(2);
  if (!state || !isAbsolute(state)) {
    console.error('Usage: node gh-stand-in.mjs <absolute state folder> <gh arguments...>');
    process.exit(2);
  }
  try {
    console.log(gh(state, args));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
