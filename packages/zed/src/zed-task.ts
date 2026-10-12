// A global Zed task that opens a new terminal tab and resumes the next
// pending session in it. Pressing its keybinding N times restores N
// sessions, each in its own tab, without touching the shell startup file.

import { isRecord } from '@claude-resurrect/core';
import type { Mode } from './mode';
import { SKIP_VARIABLE } from './shell-init';

export const TASK_LABEL = 'Claude Resurrect: next session';

export const TERMINAL_TARGETS = ['center', 'dock'] as const;

export type TerminalTarget = (typeof TERMINAL_TARGETS)[number];

export const isTerminalTarget = (value: unknown): value is TerminalTarget =>
  TERMINAL_TARGETS.some((target) => target === value);

export interface ZedTask {
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly use_new_terminal: boolean;
  readonly allow_concurrent_runs: boolean;
  readonly reveal: 'always' | 'never';
  // "center" opens the tab in the editor area, "dock" in the terminal panel.
  readonly reveal_target: TerminalTarget;
}

// The tab ends in an interactive login shell, the same kind Zed itself
// starts, so profile files such as nvm setup apply and the tab remains a
// usable terminal once Claude exits. The skip variable stops the shell
// snippet from asking about yet another session in it.
export const resurrectTask = (
  mode: Mode,
  target: TerminalTarget = 'center',
  binary = 'claude-resurrect-zed',
): ZedTask => ({
  label: TASK_LABEL,
  command: 'sh',
  args: [
    '-c',
    mode !== 'always'
      ? `${binary} pick --cwd "$PWD"; exec "\${SHELL:-sh}" -il`
      : `cmd="$(${binary} next --mode ${mode} --cwd "$PWD")"; if [ -n "$cmd" ]; then eval "$cmd"; else echo "Claude Resurrect: nothing to restore here."; fi; exec "\${SHELL:-sh}" -il`,
  ],
  env: { [SKIP_VARIABLE]: '1' },
  use_new_terminal: true,
  allow_concurrent_runs: true,
  reveal: 'always',
  reveal_target: target,
});

const isOurTask = (task: unknown): boolean => isRecord(task) && task.label === TASK_LABEL;

// Replaces an earlier copy of the task and keeps every other task untouched.
export const withResurrectTask = (tasks: readonly unknown[], task: ZedTask): readonly unknown[] => [
  ...tasks.filter((existing) => !isOurTask(existing)),
  task,
];

export const withoutResurrectTask = (tasks: readonly unknown[]): readonly unknown[] =>
  tasks.filter((existing) => !isOurTask(existing));
