// A plain-text report of everything that decides whether a terminal gets a
// session: the environment guards, the hooks, and the state on disk.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  claudeConfigDirectory,
  isResurrectEntry,
  loadSessions,
  readSettings,
  runningSessionIds,
  stateDirectory,
} from '@claude-resurrect/core';
import type { RestoreCandidate, SessionRecord } from '@claude-resurrect/core';

export interface DoctorInput {
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly stdinIsTerminal: boolean;
  readonly pending: readonly RestoreCandidate[];
  readonly declined: ReadonlySet<string>;
}

const yesNo = (value: boolean): string => (value ? 'yes' : 'no');

const hooksInstalled = (): boolean =>
  Object.values(readSettings(path.join(claudeConfigDirectory(), 'settings.json')).hooks ?? {}).some(
    (entries) => entries.some(isResurrectEntry),
  );

const freshClaims = (): readonly string[] => {
  const folder = path.join(stateDirectory(), 'claims');
  const now = Date.now();
  return (fs.existsSync(folder) ? fs.readdirSync(folder) : []).filter(
    (name) => now - fs.statSync(path.join(folder, name)).mtimeMs < 5 * 60 * 1000,
  );
};

const describeSession = (session: SessionRecord, running: ReadonlySet<string>): string => {
  const state = running.has(session.sessionId) ? 'running' : session.status;
  const when = new Date(session.endedAt ?? session.startedAt ?? 0).toLocaleString();
  return `  ${state.padEnd(11)} ${session.sessionId.slice(0, 8)}  ${when}  ${session.cwd ?? '?'}`;
};

export const doctorReport = (input: DoctorInput): string => {
  const env = input.environment;
  const running = runningSessionIds();
  const interrupted = Object.values(loadSessions()).filter((s) => s.status === 'interrupted');
  return [
    'Claude Resurrect doctor',
    '',
    'Shell guards (all must be yes for the shell snippet to act)',
    `  TERM_PROGRAM is zed:        ${yesNo(env.TERM_PROGRAM === 'zed')} (${env.TERM_PROGRAM ?? 'unset'})`,
    `  not inside Claude Code:     ${yesNo(!env.CLAUDECODE)}`,
    `  CLAUDE_RESURRECT_SKIP unset: ${yesNo(!env.CLAUDE_RESURRECT_SKIP)}`,
    `  stdin is a terminal:        ${yesNo(input.stdinIsTerminal)}`,
    '',
    'Setup',
    `  hooks in settings.json:     ${yesNo(hooksInstalled())}`,
    `  state directory:            ${stateDirectory()}`,
    `  folder checked:             ${input.cwd}`,
    '',
    `Pending for this folder: ${input.pending.length}`,
    ...input.pending.map((c) => `  ${c.sessionId.slice(0, 8)}  ${c.name ?? ''}  ${c.cwd}`),
    '',
    `Interrupted sessions anywhere: ${interrupted.length}`,
    ...interrupted.map((s) => describeSession(s, running)),
    '',
    `Declined ids: ${input.declined.size === 0 ? 'none' : [...input.declined].map((id) => id.slice(0, 8)).join(', ')}`,
    `Fresh claims (sessions another terminal is resuming right now): ${freshClaims().length === 0 ? 'none' : freshClaims().join(', ')}`,
    '',
  ].join('\n');
};
