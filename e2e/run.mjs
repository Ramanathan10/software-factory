import { readdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { harnesses, row } from '../adapters/harnesses.mjs';
import { openRig } from './rig.mjs';

const folder = new URL('./scenarios/', import.meta.url);
const names = readdirSync(folder).filter(file => file.endsWith('.mjs')).map(file => file.slice(0, -4)).sort();
const load = name => import(new URL(name + '.mjs', folder));
const commandLine = Object.keys(harnesses).filter(name => harnesses[name].workers === 'command-line');
const known = name => {
  try {
    row(name);
    return true;
  } catch {
    return false;
  }
};
const usage = 'Usage: node e2e/run.mjs [harness] [scenario ...] [--keep] [--turn-seconds <n>]\n' +
  '       node e2e/run.mjs --list\n' +
  'Without a harness, every scenario runs once for each harness whose workers start from the command line: ' + commandLine.join(', ') + '\n' +
  'Scenarios: ' + names.join(', ');

async function main() {
  let values;
  let chosen;
  let entries;
  try {
    let positionals;
    ({ values, positionals } = parseArgs({ allowPositionals: true, options: {
      keep: { type: 'boolean' }, list: { type: 'boolean' },
      'turn-seconds': { type: 'string', default: '60' },
    } }));
    if (values.list) {
      for (const name of names) console.log(name + ' - ' + (await load(name)).title);
      return 0;
    }
    if (!(Number(values['turn-seconds']) > 0)) throw new Error('Give --turn-seconds a positive number.');
    const named = positionals.length && known(positionals[0]) ? positionals[0] : undefined;
    chosen = named ? positionals.slice(1) : positionals;
    const unknown = chosen.filter(name => !names.includes(name));
    if (unknown.length) throw new Error('Unknown scenario or harness: ' + unknown.join(', ') + '.');
    entries = (named ? [named] : commandLine).map(row);
    const other = entries.find(entry => entry.workers !== 'command-line');
    if (other) throw new Error(other.name + ' does not start workers from the command line, so these checks cannot drive it.');
  } catch (error) {
    console.error(error.message + '\n' + usage);
    return 2;
  }

  const tally = { steps: 0, failed: 0 };
  const failedScenarios = [];
  const selected = chosen.length ? chosen : names;
  for (const entry of entries) {
    for (const name of selected) {
      const scenario = await load(name);
      console.log('# ' + entry.name + ': ' + name + ': ' + scenario.title);
      const before = tally.failed;
      let rig;
      try {
        rig = await openRig({ entry, turnMs: Number(values['turn-seconds']) * 1000, tally, profile: scenario.profile?.(entry) });
        await scenario.run(rig);
        await rig.step('every turn started and ended in order, none failed or was lost, and no worker is left running', () => rig.checkTurns());
        await rig.step('every worker and Jarvis turn ran the scripted program with ' + entry.name + '\'s start or resume arguments', () => rig.checkCalls());
      } catch (error) {
        if (tally.failed === before) {
          tally.failed += 1;
          console.log('not ok - ' + entry.name + ': ' + name + ': ' + error.message);
        }
      } finally {
        if (tally.failed > before) failedScenarios.push(entry.name + ': ' + name);
        await rig?.close({ keep: values.keep || tally.failed > before });
      }
    }
  }
  const harnessNames = entries.map(entry => entry.name).join(', ');
  console.log(failedScenarios.length
    ? 'FAILED: ' + failedScenarios.join(', ')
    : 'PASSED: ' + harnessNames + ', ' + selected.length + ' scenarios each, ' + tally.steps + ' steps');
  return failedScenarios.length ? 1 : 0;
}

process.exitCode = await main();
