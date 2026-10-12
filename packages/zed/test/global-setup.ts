import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

// The CLI tests spawn the bundled file in dist/, so build first.
export default function setup(): void {
  execFileSync(process.execPath, [path.resolve(__dirname, '..', 'scripts', 'build.mjs')], {
    stdio: 'inherit',
  });
}
