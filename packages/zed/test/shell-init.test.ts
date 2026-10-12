import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { shellSnippet } from '../src/shell-init';
import { resurrectTask } from '../src/zed-task';

const isValidIn = (shell: string, script: string): boolean => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-sh-')), 'snippet.sh');
  fs.writeFileSync(file, script);
  return spawnSync(shell, ['-n', file]).status === 0;
};

describe('shellSnippet', () => {
  it('only acts in an interactive Zed terminal outside Claude', () => {
    const snippet = shellSnippet('ask');

    expect(snippet).toContain('"$TERM_PROGRAM" = "zed"');
    expect(snippet).toContain('-z "$CLAUDECODE"');
    expect(snippet).toContain('-z "$CLAUDE_RESURRECT_SKIP"');
    expect(snippet).toContain('case "$-" in');
    expect(snippet).toContain('*i*)');
    expect(snippet).toContain('line --mode ask');
  });

  it.each(['ask', 'always', 'never'] as const)('is valid POSIX shell in %s mode', (mode) => {
    expect(isValidIn('sh', shellSnippet(mode))).toBe(true);
  });

  it('shows a status in the message area in hint mode and never resumes', () => {
    const snippet = shellSnippet('hint', 'claude-resurrect-zed', 'cmd-shift-x');

    expect(snippet).toContain('zle -M "$__claude_resurrect_hint"');
    expect(snippet).toContain('summary --cwd "$PWD" --key "cmd-shift-x"');
    expect(snippet).not.toContain(' next ');
    expect(snippet).not.toContain(' line ');
    expect(isValidIn('sh', snippet)).toBe(true);
    expect(isValidIn('zsh', snippet)).toBe(true);
  });

  it('does nothing at all in never mode', () => {
    expect(shellSnippet('never')).not.toContain('next');
  });

  it('pushes the command onto the zsh buffer stack and accepts it only in always mode', () => {
    expect(shellSnippet('ask')).toContain('print -z -- "$__claude_resurrect_command"');
    expect(shellSnippet('ask')).not.toContain('add-zle-hook-widget line-init');
    expect(shellSnippet('always')).toContain(
      'add-zle-hook-widget line-init __claude_resurrect_accept',
    );
  });

  it('defers the work to the first prompt in zsh and bash', () => {
    const snippet = shellSnippet('ask');

    expect(snippet).toContain('add-zsh-hook precmd __claude_resurrect_precmd');
    expect(snippet).toContain('PROMPT_COMMAND="__claude_resurrect_prompt_command;');
  });

  it('parses in zsh and bash as well', () => {
    expect(isValidIn('zsh', shellSnippet('ask'))).toBe(true);
    expect(isValidIn('bash', shellSnippet('ask'))).toBe(true);
  });

  it.each([{ shell: 'bash', args: ['--norc', '-i'] }])(
    'runs the command the CLI prints before the first prompt in $shell',
    ({ shell, args }) => {
      const fakeBinary = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-bin-')),
        'fake',
      );
      fs.writeFileSync(fakeBinary, '#!/bin/sh\necho "echo resumed-$3"\n', { mode: 0o755 });

      const result = spawnSync(shell, args, {
        encoding: 'utf8',
        input: `${shellSnippet('always', fakeBinary)}\nexit\n`,
        env: { ...process.env, TERM_PROGRAM: 'zed', CLAUDECODE: '', CLAUDE_RESURRECT_SKIP: '' },
      });

      expect(result.stdout).toContain('resumed-always');
    },
  );
});

describe('resurrectTask command', () => {
  it('is valid POSIX shell', () => {
    expect(isValidIn('sh', resurrectTask('always').args[1] ?? '')).toBe(true);
  });
});
