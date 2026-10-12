// Decides which existing terminal tab, if any, should host a resumed
// session. After a restart the editor restores tabs as fresh shells and, at
// least in Cursor, drops the names they had, so the decision cannot rely on
// names alone. An idle shell in the session's folder is the best candidate,
// then one whose folder is unknown; a shell known to sit elsewhere is never
// taken over.

import { displayName } from '@claude-resurrect/core';
import type { RestoreCandidate } from '@claude-resurrect/core';

const SHORT_ID_LENGTH = 8;
const TAB_NAME_MAX_LENGTH = 40;

export interface TerminalFacts {
  readonly name: string;
  readonly cwd: string | undefined;
  readonly idle: boolean;
}

export const shortSessionId = (sessionId: string): string => sessionId.slice(0, SHORT_ID_LENGTH);

// Tab titles are short; a long conversation title is cut, a user name or the
// short id is used as is.
export const terminalNameFor = (
  candidate: Pick<RestoreCandidate, 'sessionId' | 'name' | 'title'>,
): string => {
  const name = displayName(candidate);
  return name.length <= TAB_NAME_MAX_LENGTH ? name : `${name.slice(0, TAB_NAME_MAX_LENGTH - 1)}…`;
};

export const terminalMatchesSession = (
  terminalName: string,
  candidate: Pick<RestoreCandidate, 'sessionId' | 'name' | 'title'>,
): boolean => {
  const name = terminalName.trim();
  if (name === '') return false;
  if (name === terminalNameFor(candidate)) return true;
  if (name.includes(shortSessionId(candidate.sessionId))) return true;
  return candidate.name !== undefined && name.includes(candidate.name);
};

// Lower is better; undefined means the terminal must not be used.
export const reuseRank = (
  terminal: TerminalFacts,
  candidate: Pick<RestoreCandidate, 'sessionId' | 'name' | 'title' | 'cwd'>,
): number | undefined => {
  if (!terminal.idle) return undefined;
  if (terminalMatchesSession(terminal.name, candidate)) return 0;
  if (terminal.cwd === candidate.cwd) return 1;
  if (terminal.cwd === undefined) return 2;
  return undefined;
};

export const pickTerminalToReuse = <T extends TerminalFacts>(
  terminals: readonly T[],
  candidate: Pick<RestoreCandidate, 'sessionId' | 'name' | 'title' | 'cwd'>,
): T | undefined =>
  terminals
    .map((terminal) => ({ terminal, rank: reuseRank(terminal, candidate) }))
    .filter((entry): entry is { terminal: T; rank: number } => entry.rank !== undefined)
    .sort((a, b) => a.rank - b.rank)[0]?.terminal;
