import { readdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { harnesses, launchProblem, row } from '../adapters/harnesses.mjs';
import { openRig } from './rig.mjs';

const folder = new URL('./scenarios/', import.meta.url);
const names = readdirSync(folder).filter(file => file.endsWith('.mjs')).map(file => file.slice(0, -4)).sort();
const cheapest = { 'claude-code': 'haiku', codex: 'gpt-6-luna' };
const load = name => import(new URL(name + '.mjs', folder));
const usage = 'Usage: node e2e/run.mjs <harness> [scenario ...] [--model <name>] [--unrestricted] [--keep] [--turn-seconds <n>]\n' +
  '       node e2e/run.mjs --list\n' +
  'Harnesses with workers started from the command line: ' +
  Object.keys(harnesses).filter(name => harnesses[name].workers === 'command-line').join(', ') + '\n' +
  'Scenarios: ' + names.join(', ');

async function main() {
  let values;
  let harness;
  let chosen;
  let entry;
  try {
    ({ values, positionals: [harness, ...chosen] } = parseArgs({ allowPositionals: true, options: {
      model: { type: 'string' }, unrestricted: { type: 'boolean' }, keep: { type: 'boolean' }, list: { type: 'boolean' },
      'turn-seconds': { type: 'string', default: '300' },
    } }));
    if (values.list) {
      for (const name of names) console.log(name + ' - ' + (await load(name)).title);
      return 0;
    }
    if (!harness || !(Number(values['turn-seconds']) > 0)) throw new Error('Name one harness.');
    const unknown = chosen.filter(name => !names.includes(name));
    if (unknown.length) throw new Error('Unknown scenario: ' + unknown.join(', ') + '.');
    entry = row(harness);
    if (entry.workers !== 'command-line') throw new Error(entry.name + ' does not start workers from the command line, so these checks cannot drive it.');
    const problem = launchProblem(entry.name);
    if (problem) throw new Error(problem);
  } catch (error) {
    console.error(error.message + '\n' + usage);
    return 2;
  }

  const tally = { steps: 0, failed: 0 };
  const failedScenarios = [];
  const selected = chosen.length ? chosen : names;
  for (const name of selected) {
    const scenario = await load(name);
    console.log('# ' + name + ': ' + scenario.title);
    const before = tally.failed;
    let rig;
    try {
      rig = await openRig({ entry, model: values.model ?? cheapest[entry.id], unrestricted: values.unrestricted, turnMs: Number(values['turn-seconds']) * 1000, tally, profile: scenario.profile?.(entry) });
      await scenario.run(rig);
      await rig.step('every turn started and ended in order, none failed or was lost, and no worker is left running', () => rig.checkTurns());
    } catch (error) {
      if (tally.failed === before) {
        tally.failed += 1;
        console.log('not ok - ' + name + ': ' + error.message);
      }
    } finally {
      if (tally.failed > before) failedScenarios.push(name);
      await rig?.close({ keep: values.keep || tally.failed > before });
    }
  }
  console.log(failedScenarios.length
    ? 'FAILED: ' + entry.name + ', ' + failedScenarios.join(', ')
    : 'PASSED: ' + entry.name + ', ' + selected.length + ' scenarios, ' + tally.steps + ' steps');
  return failedScenarios.length ? 1 : 0;
}

process.exitCode = await main();
