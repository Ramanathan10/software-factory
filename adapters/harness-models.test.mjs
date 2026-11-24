import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { harnesses } from './harnesses.mjs';

const cli = fileURLToPath(new URL('./harnesses.mjs', import.meta.url));

function folder(t) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-models-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(path, content) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
}

const catalog = {
  version: 2,
  catalog: {
    surface: 'cc',
    config: {
      id: 'cc',
      models: [{ id: 'model-alpha-1', section: 'main' }, { id: 'model-beta-1', section: 'overflow' }],
      provider_alias_targets: { alpha: { default: 'model-alpha-1' }, beta: { default: 'model-beta-1' } },
    },
  },
};

function claudeHome(t) {
  const dir = folder(t);
  const config = join(dir, 'claude-config');
  const repository = join(dir, 'repo');
  mkdirSync(repository);
  write(join(config, 'cache', 'model-catalog', 'account-cc.json'), catalog);
  return { config, repository };
}

const reader = name => {
  const models = harnesses[name].models;
  assert.equal(typeof models, 'function', `${name} has a models reader`);
  return models;
};

test('every command-line harness can say which models it offers and its default', () => {
  for (const [name, entry] of Object.entries(harnesses).filter(([, entry]) => entry.workers === 'command-line')) {
    assert.equal(typeof entry.models, 'function', name);
  }
});

test('Claude Code lists its catalog models and aliases, and the user settings default', t => {
  const { config, repository } = claudeHome(t);
  write(join(config, 'settings.json'), { model: 'model-from-user' });
  const result = reader('Claude Code')({ env: { CLAUDE_CONFIG_DIR: config }, repository });
  assert.deepEqual([...result.names].sort(), ['alpha', 'beta', 'model-alpha-1', 'model-beta-1']);
  assert.ok(result.namesFrom.includes(join(config, 'cache', 'model-catalog')), result.namesFrom);
  assert.equal(result.default, 'model-from-user');
  assert.ok(result.defaultFrom.includes(join(config, 'settings.json')), result.defaultFrom);
});

test('a repository settings file beats the user one, and the local one beats the shared one', t => {
  const { config, repository } = claudeHome(t);
  write(join(config, 'settings.json'), { model: 'model-from-user' });
  write(join(repository, '.claude', 'settings.json'), { model: 'model-from-repo' });
  const shared = reader('Claude Code')({ env: { CLAUDE_CONFIG_DIR: config }, repository });
  assert.equal(shared.default, 'model-from-repo');
  assert.ok(shared.defaultFrom.includes(join(repository, '.claude', 'settings.json')), shared.defaultFrom);

  write(join(repository, '.claude', 'settings.local.json'), { model: 'model-from-local' });
  const local = reader('Claude Code')({ env: { CLAUDE_CONFIG_DIR: config }, repository });
  assert.equal(local.default, 'model-from-local');
  assert.ok(local.defaultFrom.includes(join(repository, '.claude', 'settings.local.json')), local.defaultFrom);
});

test('ANTHROPIC_MODEL beats every settings file', t => {
  const { config, repository } = claudeHome(t);
  write(join(config, 'settings.json'), { model: 'model-from-user' });
  write(join(repository, '.claude', 'settings.local.json'), { model: 'model-from-local' });
  const result = reader('Claude Code')({ env: { CLAUDE_CONFIG_DIR: config, ANTHROPIC_MODEL: 'model-from-env' }, repository });
  assert.equal(result.default, 'model-from-env');
  assert.match(result.defaultFrom, /ANTHROPIC_MODEL/);
});

test('Claude Code with no default set says the account chooses', t => {
  const { config, repository } = claudeHome(t);
  const result = reader('Claude Code')({ env: { CLAUDE_CONFIG_DIR: config }, repository });
  assert.match(JSON.stringify([result.default, result.defaultFrom]), /account's default/);
});

test('a missing or malformed Claude Code catalog gives no names and says where it looked', t => {
  const dir = folder(t);
  const config = join(dir, 'empty-config');
  mkdirSync(config);
  const missing = reader('Claude Code')({ env: { CLAUDE_CONFIG_DIR: config }, repository: dir });
  assert.deepEqual(missing.names, []);
  assert.ok(missing.namesFrom.includes(config), missing.namesFrom);

  write(join(config, 'cache', 'model-catalog', 'account-cc.json'), '{ not json');
  const malformed = reader('Claude Code')({ env: { CLAUDE_CONFIG_DIR: config }, repository: dir });
  assert.deepEqual(malformed.names, []);
  assert.ok(malformed.namesFrom.includes(config), malformed.namesFrom);

  write(join(config, 'cache', 'model-catalog', 'account-cc.json'), { version: 3, somethingElse: [] });
  assert.deepEqual(reader('Claude Code')({ env: { CLAUDE_CONFIG_DIR: config }, repository: dir }).names, []);
});

test('Codex lists the models its cache shows, leaving hidden ones out, and the config.toml default', t => {
  const home = join(folder(t), 'codex-home');
  write(join(home, 'models_cache.json'), {
    models: [
      { slug: 'codex-model-one', visibility: 'list' },
      { slug: 'codex-model-secret', visibility: 'hide' },
      { slug: 'codex-model-two', visibility: 'list' },
    ],
  });
  write(join(home, 'config.toml'), 'model = "codex-model-two"\nmodel_reasoning_effort = "medium"\n');
  const result = reader('Codex')({ env: { CODEX_HOME: home } });
  assert.deepEqual([...result.names].sort(), ['codex-model-one', 'codex-model-two']);
  assert.ok(result.namesFrom.includes(join(home, 'models_cache.json')), result.namesFrom);
  assert.equal(result.default, 'codex-model-two');
  assert.ok(result.defaultFrom.includes(join(home, 'config.toml')), result.defaultFrom);
});

test('Codex with no cache and no config gives no names and says the program chooses', t => {
  const home = join(folder(t), 'codex-empty');
  mkdirSync(home);
  const result = reader('Codex')({ env: { CODEX_HOME: home } });
  assert.deepEqual(result.names, []);
  assert.ok(result.namesFrom.includes(home), result.namesFrom);
  assert.match(JSON.stringify([result.default, result.defaultFrom]), /built-in default/);

  write(join(home, 'models_cache.json'), 'not json at all');
  assert.deepEqual(reader('Codex')({ env: { CODEX_HOME: home } }).names, []);
});

test('the models mode prints what the reader found, and a bad mode prints usage naming both modes', t => {
  const { config, repository } = claudeHome(t);
  const env = { ...process.env, CLAUDE_CONFIG_DIR: config };
  delete env.ANTHROPIC_MODEL;
  for (const harness of ['Claude Code', 'claude-code']) {
    const out = JSON.parse(execFileSync(process.execPath, [cli, 'models', harness, repository], { env, encoding: 'utf8' }));
    assert.ok(out.names.includes('model-alpha-1'), harness);
    assert.ok('default' in out && 'defaultFrom' in out && 'namesFrom' in out, harness);
  }

  let failure;
  try {
    execFileSync(process.execPath, [cli, 'tidy', 'Claude Code'], { env, encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, 'a bad mode fails');
  assert.notEqual(failure.status, 0);
  assert.match(failure.stderr, /start/);
  assert.match(failure.stderr, /models/);
});
