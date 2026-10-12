// The extension host runs inside the editor's own binary, so process.execPath
// is not a Node that the hook can use. Ask the user's login shell instead,
// which is where version managers such as nvm put node on the PATH.

import { execFileSync } from 'node:child_process';
import { attempt } from './io';

const SHELL_TIMEOUT_MS = 5000;
const FALLBACK_COMMAND = 'node';

const lastLine = (output: string): string | undefined =>
  output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .at(-1);

const askShell = (shell: string, flags: string): string | undefined =>
  attempt(() =>
    execFileSync(shell, [flags, 'command -v node'], {
      encoding: 'utf8',
      timeout: SHELL_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  );

export const findNodeBinary = (shell: string = process.env.SHELL ?? '/bin/sh'): string => {
  const found = [askShell(shell, '-lic'), askShell(shell, '-lc')]
    .map((output) => (output === undefined ? undefined : lastLine(output)))
    .find((candidate) => candidate !== undefined && candidate.startsWith('/'));
  return found ?? FALLBACK_COMMAND;
};
