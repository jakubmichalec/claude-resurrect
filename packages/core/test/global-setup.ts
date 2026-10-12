import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

// The hook and installer tests spawn the bundled files in dist/, so build first.
export default function setup(): void {
  execFileSync(process.execPath, [path.resolve(__dirname, '..', 'scripts', 'build.mjs')], {
    stdio: 'inherit',
  });
}
