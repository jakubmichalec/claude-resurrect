import { describe, expect, it } from 'vitest';
import {
  hasShellInit,
  shellInitLine,
  shellRcPath,
  withShellInit,
  withoutShellInit,
} from '../src/shell-rc';

const line = shellInitLine();

describe('shellRcPath', () => {
  it.each([
    { shell: '/bin/zsh', expected: '/home/me/.zshrc' },
    { shell: '/bin/bash', expected: '/home/me/.bashrc' },
    { shell: '/opt/homebrew/bin/fish', expected: '/home/me/.config/fish/config.fish' },
    { shell: undefined, expected: '/home/me/.zshrc' },
  ])('maps $shell to $expected', ({ shell, expected }) => {
    expect(shellRcPath(shell, '/home/me')).toBe(expected);
  });
});

describe('withShellInit', () => {
  it('appends a marked block to an existing file', () => {
    const result = withShellInit('export FOO=1\n', line);

    expect(result).toBe(
      `export FOO=1\n\n# >>> claude-resurrect >>>\n${line}\n# <<< claude-resurrect <<<\n`,
    );
    expect(hasShellInit(result)).toBe(true);
  });

  it('creates the block alone in an empty file', () => {
    expect(withShellInit('', line)).toBe(
      `# >>> claude-resurrect >>>\n${line}\n# <<< claude-resurrect <<<\n`,
    );
  });

  it('replaces an earlier block instead of adding a second one', () => {
    const once = withShellInit('a\n', line);
    const twice = withShellInit(once, shellInitLine('claude-resurrect-zed', 'always'));

    expect(twice.match(/>>> claude-resurrect >>>/g)).toHaveLength(1);
    expect(twice).toContain('--mode always');
  });

  it('includes the mode when given', () => {
    expect(shellInitLine('claude-resurrect-zed', 'never')).toBe(
      'eval "$(claude-resurrect-zed shell-init --mode never)"',
    );
  });
});

describe('withoutShellInit', () => {
  it('restores the original content', () => {
    const original = 'export FOO=1\nalias ll="ls -l"\n';

    expect(withoutShellInit(withShellInit(original, line))).toBe(original);
  });

  it('leaves a file without the block untouched', () => {
    expect(withoutShellInit('plain\n')).toBe('plain\n');
  });

  it('removes a block that sits between other lines', () => {
    const content = `a\n\n# >>> claude-resurrect >>>\n${line}\n# <<< claude-resurrect <<<\nb\n`;

    expect(withoutShellInit(content)).toBe('a\nb\n');
  });
});
