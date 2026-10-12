// Adds the shell snippet line to the user's shell startup file inside a
// marked block, so it can be found, replaced and removed again.

import * as path from 'node:path';

const BLOCK_START = '# >>> claude-resurrect >>>';
const BLOCK_END = '# <<< claude-resurrect <<<';
// Swallows the blank line written before the block, so removal restores the
// file to its earlier shape.
const BLOCK_PATTERN = /\n?# >>> claude-resurrect >>>[\s\S]*?# <<< claude-resurrect <<<\n?/;

export const shellRcPath = (shell: string | undefined, home: string): string => {
  const name = path.basename(shell ?? '');
  if (name === 'bash') return path.join(home, '.bashrc');
  if (name === 'fish') return path.join(home, '.config', 'fish', 'config.fish');
  return path.join(home, '.zshrc');
};

export const shellInitLine = (
  binary = 'claude-resurrect-zed',
  mode?: string,
  key?: string,
): string =>
  `eval "$(${binary} shell-init${mode === undefined ? '' : ` --mode ${mode}`}${key === undefined ? '' : ` --key ${key}`})"`;

export const hasShellInit = (content: string): boolean => content.includes(BLOCK_START);

export const withoutShellInit = (content: string): string => content.replace(BLOCK_PATTERN, '');

export const withShellInit = (content: string, line: string): string => {
  const block = `${BLOCK_START}\n${line}\n${BLOCK_END}\n`;
  const stripped = withoutShellInit(content);
  if (stripped === '') return block;
  const terminated = stripped.endsWith('\n') ? stripped : `${stripped}\n`;
  return `${terminated}\n${block}`;
};
