import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Whether the module at `moduleUrl` is the program Node was asked to run. Skills are installed as links, and
// Node names the main module by its real path while process.argv[1] keeps the linked one, so a plain
// comparison is false through a link and the CLI exits 0 having done nothing.
export function isMain(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
