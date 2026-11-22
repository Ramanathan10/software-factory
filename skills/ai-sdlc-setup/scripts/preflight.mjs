#!/usr/bin/env node
// AI SDLC preflight: detect machine and repository facts, and check the saved profile.
//   node preflight.mjs detect [repoDir]   facts for the setup interview
//   node preflight.mjs check  [repoDir]   validate the profile and gate tools; exit 1 on problems
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const assets = fileURLToPath(new URL('../assets/', import.meta.url));
const schema = name => JSON.parse(readFileSync(join(assets, name), 'utf8'));

export const profileHome = (env = process.env) => env.AI_SDLC_HOME || join(homedir(), '.ai-sdlc');

const typeOf = value => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);

// Validates the JSON Schema subset the profile schema uses.
export function validate(value, rules, at = 'profile') {
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
  const machine = readJson(machinePath, problems, 'Machine profile');
  // Each person keeps their own checks for a repository, so its section lives in their own profile, never in the repository.
  const repoProfile = machine?.repos?.[slug];
  const source = repoProfile ? `${machinePath} repos["${slug}"]` : null;
  return { root, slug, machinePath, machine, repoProfile, source, problems };
}

function gateProblem(name, command, root, env) {
  const tool = command.trim().split(/\s+/)[0];
  if (!tool) return `gate ${name} has an empty command`;
  const local = /[\\/]/.test(tool);
  const found = local ? existsSync(isAbsolute(tool) ? tool : join(root, tool)) : onPath(tool, env);
  return found ? null : `gate ${name} needs "${tool}", which was not found${local ? ' in the repository' : ' on PATH'}`;
}

// The files Jarvis runs, by where each sits inside the folder that holds the Command Center.
const commandCenterFiles = {
  console: 'mission-console/jarvis.mjs',
  harnesses: 'adapters/harnesses.mjs',
  launcher: 'command-center/serve.mjs',
  reference: 'mission-console/README.md',
  readiness: 'readiness-sync/check-story.mjs',
};
const holdsCommandCenter = folder => Object.values(commandCenterFiles).every(file => existsSync(join(folder, file)));

// Where the Command Center is, worked out from this script's real location: the checkout when the skills
// are linked from it, or the extension folder beside the skills when a harness was given copies.
export function findCommandCenter(script = realpathSync(fileURLToPath(import.meta.url))) {
  const skills = resolve(script, '../../..');
  return [resolve(skills, '..'), resolve(skills, '../extensions/ai-sdlc-console')].find(holdsCommandCenter) ?? null;
}

// Returns what is wrong with the saved Command Center folder, or null when Jarvis can run its files from it.
function commandCenterProblem(saved, found) {
  if (saved && holdsCommandCenter(saved)) return null;
  const fix = found
    ? `Set it to "${found}", where the Command Center is now.`
    : 'Run "node install.mjs" from the software-factory checkout, then the ai-sdlc-setup skill.';
  return saved ? `commandCenterPath "${saved}" does not hold the Command Center. ${fix}` : `profile.commandCenterPath is not set. ${fix}`;
}

export const DEFAULT_BRANCH_PATTERN = 'story/{id}-{slug}';

// Returns what is wrong with a branch pattern, or null when a story branch can be named from it.
export function branchPatternProblem(pattern) {
  for (const placeholder of ['{id}', '{slug}']) if (!pattern.includes(placeholder)) return `must contain ${placeholder}`;
  const fixed = pattern.replaceAll('{id}', '').replaceAll('{slug}', '');
  if (/[{}]/.test(fixed)) return 'may use only the {id} and {slug} placeholders';
  // What git refuses in a branch name: https://git-scm.com/docs/git-check-ref-format
  if (/[\s~^:?*[\\]|\.\.|\/\/|^[/-]|[/.]$/.test(pattern)) return 'is not a valid git branch name';
  return null;
}

const list = dir => (existsSync(dir) ? readdirSync(dir) : []);

// Software the lifecycle runs beyond the agent itself. kind: core (every story), gate (a required gate's tool),
// optional (a capability the owner may decline). install is a suggestion to show the owner, never run unasked.
export function components(root, env = process.env, platform = process.platform) {
  const files = list(root);
  const dotnet = files.some(file => /\.(sln|csproj)$/.test(file));
  const azure = /dev\.azure\.com|visualstudio\.com/.test(git(root, 'remote', 'get-url', 'origin'));
  const local = name => onPath(name, env) || existsSync(join(root, 'node_modules', '.bin', name));
  let dotnetTools = '';
  try { dotnetTools = readFileSync(join(root, '.config', 'dotnet-tools.json'), 'utf8'); } catch { /* no local tool manifest */ }
  const manager = (win, mac) => ({ win32: `winget install ${win}`, darwin: `brew install ${mac}` })[platform] ?? `install ${mac} with the system package manager`;
  return [
    { name: 'git', kind: 'core', neededFor: 'story worktrees and branches', found: onPath('git', env), install: manager('Git.Git', 'git') },
    azure
      ? { name: 'az', kind: 'core', neededFor: 'opening the pull request', found: onPath('az', env), install: manager('Microsoft.AzureCLI', 'azure-cli') }
      : { name: 'gh', kind: 'core', neededFor: 'opening the pull request', found: onPath('gh', env), install: manager('GitHub.cli', 'gh') },
    dotnet
      ? { name: 'stryker', kind: 'gate', neededFor: 'mutation testing', found: onPath('dotnet-stryker', env) || dotnetTools.includes('dotnet-stryker'), install: 'dotnet tool install --global dotnet-stryker' }
      : { name: 'stryker', kind: 'gate', neededFor: 'mutation testing', found: local('stryker'), install: 'npm install --save-dev @stryker-mutator/core' },
    { name: 'gitleaks', kind: 'gate', neededFor: 'secret scanning', found: onPath('gitleaks', env), install: manager('Gitleaks.Gitleaks', 'gitleaks') },
    { name: 'ffmpeg', kind: 'optional', neededFor: 'rendering video', found: onPath('ffmpeg', env), install: manager('Gyan.FFmpeg', 'ffmpeg') },
    { name: 'hyperframes', kind: 'optional', neededFor: 'explainer videos with the hyperframes skill', found: local('hyperframes'), install: 'npm install --save-dev hyperframes (in the video project)' },
  ];
}

// Decides what a missing component means for a story: 'problem' stops the story, 'warning' is reported, null is silent.
// part: { name, kind, usedBy: required gates whose command names it, declined: the owner said not to ask again }.
export function componentSeverity(part) {
  // A gate's tool matters only when a required gate names it; then the profile promises a check the machine cannot run.
  if (part.kind === 'gate') return part.usedBy.length ? 'problem' : null;
  if (part.kind === 'optional' && part.declined) return null;
  // No story can make a worktree without git. A pull request can be opened another way, so its CLI only warns.
  return part.name === 'git' ? 'problem' : 'warning';
}

export function nextSteps({ problems, warnings }) {
  if (problems.length) return ['Follow the ai-sdlc-setup skill to fix each problem, then run the check again.'];
  return [
    ...(warnings.length ? ['Install each missing component with the owner\'s approval, or record it in declinedComponents so it is not raised again.'] : []),
    'Name a feature or bug to start a story with the ai-sdlc skill.',
    'Say "Be Jarvis" to run several stories in parallel and follow them in the Command Center.',
  ];
}

export function check(repo = '.', env = process.env, found = findCommandCenter()) {
  const { root, slug, machinePath, machine, repoProfile, source, problems } = loadProfiles(repo, env);
  if (!machine && !problems.length) problems.push(`No profile at ${machinePath}. Run the ai-sdlc-setup skill.`);
  if (machine) problems.push(...validate(machine, schema('profile.schema.json')));
  const centerPath = typeof machine?.commandCenterPath === 'string' ? machine.commandCenterPath : null;
  const centerProblem = machine ? commandCenterProblem(centerPath, found) : null;
  if (centerProblem) problems.push(centerProblem);
  // A repository's section is validated with the profile that holds it.
  if (!repoProfile) problems.push(`No repository section for ${slug} in ${machinePath}. Run the ai-sdlc-setup skill.`);
  const branchPattern = repoProfile?.branchPattern ?? DEFAULT_BRANCH_PATTERN;
  const patternProblem = typeof branchPattern === 'string' && branchPatternProblem(branchPattern);
  if (patternProblem) problems.push(`repos.${slug}.branchPattern ${patternProblem}`);

  const gates = {};
  const skippedGates = [];
  for (const [name, command] of Object.entries(repoProfile?.gates ?? {})) {
    if (typeof command !== 'string') { skippedGates.push(name); continue; }
    gates[name] = command;
    const problem = gateProblem(name, command, root, env);
    if (problem) problems.push(problem);
  }

  const warnings = [];
  const parts = components(root, env).map(part => ({
    ...part,
    usedBy: Object.keys(gates).filter(name => gates[name].toLowerCase().includes(part.name)),
    declined: machine?.declinedComponents?.includes(part.name) ?? false,
  }));
  for (const part of parts.filter(part => !part.found)) {
    const severity = componentSeverity(part);
    const message = `${part.name} is not installed (${part.neededFor}). Suggested install: ${part.install}`;
    if (severity === 'problem') problems.push(message);
    else if (severity === 'warning') warnings.push(message);
  }

  return {
    ok: problems.length === 0,
    problems,
    warnings,
    nextSteps: nextSteps({ problems, warnings }),
    components: parts,
    owner: machine?.ownerName ?? null,
    crossModelReviewAuthorized: machine?.crossModelReviewAuthorized === true && repoProfile?.crossModelReviewAuthorized !== false,
    sharedResources: machine?.sharedResources ?? [],
    defaultVerificationEnvironment: machine?.defaultVerificationEnvironment ?? '',
    implementationLevel: machine?.implementationLevel ?? 'full',
    reviewRoundLimit: machine?.reviewRoundLimit ?? 3,
    beforeAndAfter: machine?.beforeAndAfter ?? 'ask',
    architectureDiagram: machine?.architectureDiagram ?? 'ask',
    workerPermissions: machine?.workerPermissions ?? 'restricted',
    // The full path of each file Jarvis runs, or null until the saved folder holds them.
    commandCenter: machine && !centerProblem
      ? { path: centerPath, ...Object.fromEntries(Object.entries(commandCenterFiles).map(([name, file]) => [name, join(centerPath, file)])) }
      : null,
    adapters: machine?.adapters ?? {},
    repo: {
      root, slug, profileSource: source, gates, skippedGates, branchPattern,
      // Each story's worktree goes in <worktreeRoot>/<branch>; by default a folder beside the repository.
      worktreeRoot: repoProfile?.worktreeRoot ?? resolve(root, '..', basename(root) + '-worktrees'),
      teamRules: repoProfile?.teamRules ?? [],
      readiness: repoProfile?.readiness ?? { tracker: 'none' },
      requiredPipelines: repoProfile?.requiredPipelines ?? [],
      reviewBot: repoProfile?.reviewBot ?? 'none',
      // Absent means the default location; an explicit null keeps specs out of the repository.
      specDir: repoProfile?.specDir === undefined ? 'docs/specs' : repoProfile.specDir,
    },
  };
}

export function detect(repo = '.', env = process.env) {
  const { root, slug, machinePath, machine, source } = loadProfiles(repo, env);
  const files = list(root);
  const has = pattern => files.filter(file => pattern.test(file));
  let scripts = {};
  try { scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {}; } catch { /* not a Node project */ }
  const tools = Object.fromEntries(
    ['git', 'gh', 'az', 'npm', 'npx', 'dotnet', 'python', 'gitleaks'].map(tool => [tool, onPath(tool, env)]));
  return {
    node: process.version,
    tools,
    components: components(root, env),
    // Saved as the profile's commandCenterPath without asking; null when the files are not installed.
    commandCenterPath: findCommandCenter(),
    profiles: { home: profileHome(env), machineProfile: machinePath, machineProfileExists: Boolean(machine), repoProfileSource: source },
    repo: {
      root, slug,
      defaultBranch: git(root, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD').replace(/^origin\//, '') || null,
      packageScripts: scripts,
      manifests: has(/^(package\.json|pyproject\.toml|requirements.*\.txt|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(\.kts)?|.*\.(sln|csproj))$/),
      lockfiles: has(/^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|poetry\.lock|uv\.lock|go\.sum|Cargo\.lock)$/),
      strykerConfig: has(/^stryker[.-]conf(ig)?\./),
      scannerConfig: has(/^\.gitleaks\.toml$/),
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
