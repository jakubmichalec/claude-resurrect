import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { isShellIdle } from '../src/processes';

describe('isShellIdle', () => {
  it('is false while the process has a child and true once the child is gone', async () => {
    const child = spawn('sleep', ['5']);
    await new Promise((resolve) => child.once('spawn', resolve));

    expect(isShellIdle(process.pid)).toBe(false);

    child.kill('SIGKILL');
    await new Promise((resolve) => child.once('exit', resolve));
    expect(isShellIdle(process.pid)).toBe(true);
  });

  it('treats an impossible pid as idle because it has no children', () => {
    expect(isShellIdle(2 ** 22 - 1)).toBe(true);
  });
});
