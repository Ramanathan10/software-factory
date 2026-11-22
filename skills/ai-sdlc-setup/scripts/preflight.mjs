#!/usr/bin/env node
// AI SDLC preflight: detect machine and repository facts, and check the saved profiles.
//   node preflight.mjs detect [repoDir]   facts for the setup interview
//   node preflight.mjs check  [repoDir]   validate profiles and gate tools; exit 1 on problems
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const assets = fileURLToPath(new URL('../assets/', import.meta.url));
const schema = name => JSON.parse(readFileSync(join(assets, name), 'utf8'));
export const REPO_PROFILE_FILE = '.ai-sdlc.json';

export const profileHome = (env = process.env) => env.AI_SDLC_HOME || join(homedir(), '.ai-sdlc');

const typeOf = value => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);

// Validates the JSON Schema subset the profile schemas use.
export function validate(value, rules, at = 'profile') {
  if (rules.$ref) rules = schema(rules.$ref);
  if (rules.enum) return rules.enum.includes(value) ? [] : [`${at} must be one of ${JSON.stringify(rules.enum)}`];
  const types = [rules.type ?? []].flat();
  if (types.length && !types.includes(typeOf(value))) return [`${at} must be ${types.join(' or ')}`];
  const problems = [];
  if (typeof value === 'string' && value.length < (rules.minLength ?? 0)) problems.push(`${at} must not be empty`);
  if (typeOf(value) === 'array' && rules.items) value.forEach((item, i) => problems.push(...validate(item, rules.items, `${at}[${i}]`)));
  if (typeOf(value) === 'object') {
    for (const key of rules.required ?? []) if (!(key in value)) problems.push(`${at}.${key} is missing`);
    for (const [key, item] of Object.entries(value)) {
      const rule = rules.properties?.[key] ?? rules.additionalProperties;
      if (rule === false) problems.push(`${at}.${key} is not a known field`);
      else if (rule && rule !== true) problems.push(...validate(item, rule, `${at}.${key}`));
    }
  }
  return problems;
}

export function onPath(command, env = process.env) {
  const extensions = process.platform === 'win32' ? ['', ...(env.PATHEXT || '.EXE;.CMD;.BAT').split(';')] : [''];
  return (env.PATH || env.Path || '').split(delimiter).filter(Boolean)
    .some(dir => extensions.some(ext => existsSync(join(dir, command + ext))));
}

function git(repo, ...args) {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export function repoSlug(repo) {
  const remote = git(repo, 'remote', 'get-url', 'origin').replace(/\.git$/, '');
  const match = remote.match(/[/:]([^/:]+\/[^/]+)$/);
  return match ? match[1] : basename(resolve(repo));
}

function readJson(path, problems, label) {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    problems.push(`${label} at ${path} is not valid JSON: ${error.message}`);
    return undefined;
  }
}

export function loadProfiles(repo, env = process.env) {
  const problems = [];
  const root = git(repo, 'rev-parse', '--show-toplevel') || resolve(repo);
  const slug = repoSlug(root);
  const machinePath = join(profileHome(env), 'profile.json');
  const repoPath = join(root, REPO_PROFILE_FILE);
  const machine = readJson(machinePath, problems, 'Machine profile');
  const repoFile = readJson(repoPath, problems, 'Repository profile');
  const repoProfile = repoFile ?? machine?.repos?.[slug];
  const source = repoFile ? repoPath : repoProfile ? `${machinePath} repos["${slug}"]` : null;
  return { root, slug, machinePath, repoPath, machine, repoProfile, source, problems };
}

function gateProblem(name, command, root, env) {
  const tool = command.trim().split(/\s+/)[0];
  if (!tool) return `gate ${name} has an empty command`;
  const local = /[\\/]/.test(tool);
  const found = local ? existsSync(isAbsolute(tool) ? tool : join(root, tool)) : onPath(tool, env);
  return found ? null : `gate ${name} needs "${tool}", which was not found${local ? ' in the repository' : ' on PATH'}`;
}

export function check(repo = '.', env = process.env) {
  const { root, slug, machinePath, repoPath, machine, repoProfile, source, problems } = loadProfiles(repo, env);
  if (!machine && !problems.length) problems.push(`No machine profile at ${machinePath}. Run the ai-sdlc-setup skill.`);
  if (machine) problems.push(...validate(machine, schema('profile.schema.json'), 'machine profile'));
  if (!repoProfile) problems.push(`No repository profile for ${slug} (looked in ${repoPath} and the machine profile). Run the ai-sdlc-setup skill.`);
  // A machine-profile entry was already validated with the machine profile.
  else if (source === repoPath) problems.push(...validate(repoProfile, schema('repo-profile.schema.json'), 'repository profile'));

  const gates = {};
  const skippedGates = [];
  for (const [name, command] of Object.entries(repoProfile?.gates ?? {})) {
    if (typeof command !== 'string') { skippedGates.push(name); continue; }
    gates[name] = command;
    const problem = gateProblem(name, command, root, env);
    if (problem) problems.push(problem);
  }

  return {
    ok: problems.length === 0,
    problems,
    owner: machine?.ownerName ?? null,
    crossModelReviewAuthorized: machine?.crossModelReviewAuthorized === true && repoProfile?.crossModelReviewAuthorized !== false,
    sharedResources: machine?.sharedResources ?? [],
    defaultVerificationEnvironment: machine?.defaultVerificationEnvironment ?? '',
    repo: {
      root, slug, profileSource: source, gates, skippedGates,
      requiredPipelines: repoProfile?.requiredPipelines ?? [],
      reviewBot: repoProfile?.reviewBot ?? 'none',
      // Absent means the default location; an explicit null keeps specs out of the repository.
      specDir: repoProfile?.specDir === undefined ? 'docs/specs' : repoProfile.specDir,
    },
  };
}

const list = dir => (existsSync(dir) ? readdirSync(dir) : []);

export function detect(repo = '.', env = process.env) {
  const { root, slug, machinePath, repoPath, machine, source } = loadProfiles(repo, env);
  const files = list(root);
  const has = pattern => files.filter(file => pattern.test(file));
  let scripts = {};
  try { scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {}; } catch { /* not a Node project */ }
  const tools = Object.fromEntries(
    ['git', 'gh', 'az', 'npm', 'npx', 'dotnet', 'python', 'gitleaks', 'osv-scanner', 'semgrep'].map(tool => [tool, onPath(tool, env)]));
  return {
    node: process.version,
    tools,
    profiles: { home: profileHome(env), machineProfile: machinePath, machineProfileExists: Boolean(machine), repoProfileSource: source, repoProfileFile: repoPath },
    repo: {
      root, slug,
      defaultBranch: git(root, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD').replace(/^origin\//, '') || null,
      packageScripts: scripts,
      manifests: has(/^(package\.json|pyproject\.toml|requirements.*\.txt|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(\.kts)?|.*\.(sln|csproj))$/),
      lockfiles: has(/^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|poetry\.lock|uv\.lock|go\.sum|Cargo\.lock)$/),
      strykerConfig: has(/^stryker[.-]conf(ig)?\./),
      scannerConfig: has(/^(\.gitleaks\.toml|\.semgrep\.ya?ml|\.semgrep|osv-scanner\.toml)$/),
      ci: [...list(join(root, '.github', 'workflows')).map(file => `.github/workflows/${file}`), ...has(/^(azure-pipelines\.ya?ml|\.gitlab-ci\.yml|Jenkinsfile)$/)],
    },
  };
}

// Skills are installed as links, and Node reports this module by its real path, so compare real paths.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [mode, repo = '.'] = process.argv.slice(2);
  if (mode !== 'detect' && mode !== 'check') {
    console.error('Usage: node preflight.mjs detect|check [repoDir]');
    process.exit(2);
  }
  const result = mode === 'detect' ? detect(repo) : check(repo);
  console.log(JSON.stringify(result, null, 2));
  if (result.ok === false) process.exit(1);
}
