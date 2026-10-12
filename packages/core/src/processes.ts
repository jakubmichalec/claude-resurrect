// Process tree helpers for deciding whether a terminal's shell is idle. A
// shell with no child processes runs nothing the user would lose.

import { execFileSync } from 'node:child_process';
import { attempt } from './io';

const PGREP_TIMEOUT_MS = 2000;

const childPids = (pid: number): readonly number[] | undefined =>
  attempt(() => {
    try {
      const output = execFileSync('pgrep', ['-P', String(pid)], {
        encoding: 'utf8',
        timeout: PGREP_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return output
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map(Number);
    } catch (error) {
      // pgrep exits 1 when nothing matches, which is the answer "no children".
      const status = (error as { status?: unknown }).status;
      if (status === 1) return [];
      throw error;
    }
  });

// Unknown (pgrep missing or failing) counts as busy: better to open a new
// tab than to type into a process we cannot see.
export const isShellIdle = (shellPid: number): boolean => {
  const children = childPids(shellPid);
  return children !== undefined && children.length === 0;
};
