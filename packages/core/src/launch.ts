// Builds the shell line that resumes a session. Kept apart from the editor
// code so the quoting rules are testable.

export interface LaunchSettings {
  readonly claudeCommand: string;
  readonly extraArguments: readonly string[];
}

// Single quotes work in every POSIX shell and in PowerShell; the only
// character that needs care is a quote inside the value.
export const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

export const resumeCommand = (settings: LaunchSettings, sessionId: string): string =>
  [settings.claudeCommand, '-r', sessionId, ...settings.extraArguments].join(' ');

// A restored terminal cannot be given a cwd through the API, so the command
// moves there first. New terminals get their cwd at creation and skip this.
export const inWorkingDirectory = (command: string, cwd: string): string =>
  `cd ${shellQuote(cwd)} && ${command}`;
