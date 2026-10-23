// The snippet a user evaluates from their shell startup file. It runs only
// in an interactive terminal of an editor that restores its tabs as plain
// shells (Zed, Supacode) and that is not already inside Claude Code.
//
// zsh: just before the first prompt the CLI is asked (silently) what belongs
// in the input line: the resume command when one session is pending (claimed
// right away), or the picker when several are. It is pushed onto the line
// editor's buffer stack and appears once the prompt is up: in "ask" mode the
// user presses Enter to run it or Ctrl-C to drop it, in "always" mode a
// one-shot line-init hook accepts the oldest session's command at once. Nothing is
// printed and nothing runs before the prompt, which keeps clear of prompt
// frameworks such as Powerlevel10k's instant prompt that redirect stdin and
// stdout until then.
//
// bash: the check runs from PROMPT_COMMAND before the first prompt, with
// the CLI asking the question itself. Plain sh runs inline.

import type { Mode } from './mode';

export const SKIP_VARIABLE = 'CLAUDE_RESURRECT_SKIP';

// The TERM_PROGRAM values of the terminals the snippet acts in.
export const TERMINAL_PROGRAMS = ['zed', 'supacode'] as const;

const terminalGuard = TERMINAL_PROGRAMS.map((name) => `[ "$TERM_PROGRAM" = "${name}" ]`).join(
  ' || ',
);

const GUARD = `{ ${terminalGuard}; } && [ -z "$CLAUDECODE" ] && [ -z "$${SKIP_VARIABLE}" ]`;

const zshBranch = (mode: Mode, binary: string): readonly string[] => [
  '      __claude_resurrect_accept() {',
  '        add-zle-hook-widget -d line-init __claude_resurrect_accept',
  '        zle accept-line',
  '      }',
  '      __claude_resurrect_precmd() {',
  '        add-zsh-hook -d precmd __claude_resurrect_precmd',
  `        if ${GUARD}; then`,
  `          __claude_resurrect_command="$(${binary} line --mode ${mode} --cwd "$PWD")"`,
  '          if [ -n "$__claude_resurrect_command" ]; then',
  '            print -z -- "$__claude_resurrect_command"',
  ...(mode === 'always'
    ? [
        '            autoload -Uz add-zle-hook-widget && add-zle-hook-widget line-init __claude_resurrect_accept',
      ]
    : []),
  '          fi',
  '          unset __claude_resurrect_command',
  '        fi',
  '      }',
  '      autoload -Uz add-zsh-hook && add-zsh-hook precmd __claude_resurrect_precmd',
];

const runFunction = (mode: Mode, binary: string): readonly string[] => [
  '__claude_resurrect_run() {',
  `  if ${GUARD}; then`,
  `    __claude_resurrect_command="$(${binary} next --mode ${mode} --cwd "$PWD")"`,
  '    if [ -n "$__claude_resurrect_command" ]; then eval "$__claude_resurrect_command"; fi',
  '    unset __claude_resurrect_command',
  '  fi',
  '}',
];

// zsh shows the status in the line editor's message area, which exists for
// exactly this: text under the prompt that is not console output.
const zshHintBranch = (binary: string, key: string): readonly string[] => [
  '      __claude_resurrect_show_hint() {',
  '        add-zle-hook-widget -d line-init __claude_resurrect_show_hint',
  '        zle -M "$__claude_resurrect_hint"',
  '        unset __claude_resurrect_hint',
  '      }',
  '      __claude_resurrect_precmd() {',
  '        add-zsh-hook -d precmd __claude_resurrect_precmd',
  `        if ${GUARD}; then`,
  `          __claude_resurrect_hint="$(${binary} summary --cwd "$PWD" --key "${key}")"`,
  '          if [ -n "$__claude_resurrect_hint" ]; then',
  '            autoload -Uz add-zle-hook-widget && add-zle-hook-widget line-init __claude_resurrect_show_hint',
  '          fi',
  '        fi',
  '      }',
  '      autoload -Uz add-zsh-hook && add-zsh-hook precmd __claude_resurrect_precmd',
];

export const shellSnippet = (
  mode: Mode,
  binary = 'claude-resurrect-zed',
  key = 'cmd-shift-r',
): string => {
  if (mode === 'never') return '# claude-resurrect: disabled (mode never)\n';
  if (mode === 'hint') {
    return [
      '# claude-resurrect: point at pending Claude Code sessions in a restored Zed terminal',
      'case "$-" in',
      '  *i*)',
      '    if [ -n "$ZSH_VERSION" ]; then',
      ...zshHintBranch(binary, key),
      `    elif ${GUARD}; then`,
      `      ${binary} summary --cwd "$PWD" --key "${key}"`,
      '    fi',
      '    ;;',
      'esac',
      '',
    ].join('\n');
  }
  return [
    '# claude-resurrect: resume an interrupted Claude Code session in a restored Zed terminal',
    ...runFunction(mode, binary),
    'case "$-" in',
    '  *i*)',
    '    if [ -n "$ZSH_VERSION" ]; then',
    ...zshBranch(mode, binary),
    '    elif [ -n "$BASH_VERSION" ]; then',
    '      __claude_resurrect_prompt_command() {',
    '        PROMPT_COMMAND="${PROMPT_COMMAND#__claude_resurrect_prompt_command;}"',
    '        __claude_resurrect_run',
    '      }',
    '      PROMPT_COMMAND="__claude_resurrect_prompt_command;${PROMPT_COMMAND}"',
    '    else',
    '      __claude_resurrect_run',
    '    fi',
    '    ;;',
    'esac',
    '',
  ].join('\n');
};
