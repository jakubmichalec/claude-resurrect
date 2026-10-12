// Pure decision logic: which interrupted sessions a given editor window
// should offer to restore. Everything that touches the editor or the file
// system is passed in, so this is fully testable.

import * as path from 'node:path';
import { isDefined } from './io';
import type { SessionMap, SessionRecord } from './state';
import type { TranscriptSummary } from './transcript-title';

export interface RestoreCandidate {
  readonly sessionId: string;
  readonly cwd: string;
  readonly transcriptPath: string;
  readonly endedAt: number;
  readonly name?: string;
  // Claude's own title for the conversation, read from the transcript.
  readonly title?: string;
  readonly lastPrompt?: string;
}

const TERMINAL_ENTRYPOINT = 'cli';

// Sessions started by other front ends, such as an editor panel, are theirs
// to bring back. Unknown entrypoints are kept: the registry is best effort.
const ranInTerminal = (session: SessionRecord): boolean =>
  session.entrypoint === undefined || session.entrypoint === TERMINAL_ENTRYPOINT;

export interface RestorePlanInput {
  readonly sessions: SessionMap;
  readonly workspaceFolders: readonly string[];
  readonly runningSessionIds: ReadonlySet<string>;
  readonly ignoredSessionIds: ReadonlySet<string>;
  // Interruptions at or after this instant happened while this editor was
  // already running, so they were not caused by the shutdown being recovered.
  readonly editorStartedAt: number;
  // When set, only sessions interrupted within this window before the last
  // interruption are offered. Leave it out when the user reviews the list
  // anyway, so an unrelated later interruption cannot hide the real burst.
  readonly shutdownWindowMs?: number;
  readonly transcriptExists: (transcriptPath: string) => boolean;
  // Optional, so pure callers need not touch the file system.
  readonly summarizeTranscript?: (transcriptPath: string) => TranscriptSummary;
}

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Session ids end up inside a shell command and a file name, so only the
// UUID shape Claude Code produces is accepted.
export const isSessionId = (value: string): boolean => SESSION_ID_PATTERN.test(value);

const isInsideFolder = (cwd: string, folder: string): boolean => {
  const relative = path.relative(folder, cwd);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

export const isInsideAnyFolder = (cwd: string, folders: readonly string[]): boolean =>
  folders.some((folder) => isInsideFolder(cwd, folder));

const toCandidate = (session: SessionRecord): RestoreCandidate | undefined =>
  session.status === 'interrupted' &&
  ranInTerminal(session) &&
  isSessionId(session.sessionId) &&
  session.cwd !== undefined &&
  session.transcriptPath !== undefined &&
  session.endedAt !== undefined
    ? {
        sessionId: session.sessionId,
        cwd: session.cwd,
        transcriptPath: session.transcriptPath,
        endedAt: session.endedAt,
        ...(session.name === undefined ? {} : { name: session.name }),
      }
    : undefined;

// The last interruption before the editor started marks the shutdown being
// recovered. Sessions that died within the window before it belong to the
// same shutdown; anything older was closed one by one and is left alone.
const shutdownCutoff = (
  candidates: readonly RestoreCandidate[],
  editorStartedAt: number,
  shutdownWindowMs: number | undefined,
): number | undefined => {
  const endTimes = candidates.map((c) => c.endedAt).filter((t) => t < editorStartedAt);
  if (endTimes.length === 0) return undefined;
  return shutdownWindowMs === undefined ? -Infinity : Math.max(...endTimes) - shutdownWindowMs;
};

const byEndTime = (a: RestoreCandidate, b: RestoreCandidate): number => a.endedAt - b.endedAt;

export const planRestore = (input: RestorePlanInput): readonly RestoreCandidate[] => {
  const interrupted = Object.values(input.sessions).map(toCandidate).filter(isDefined);
  const cutoff = shutdownCutoff(interrupted, input.editorStartedAt, input.shutdownWindowMs);
  if (cutoff === undefined) return [];
  return interrupted
    .filter((c) => c.endedAt >= cutoff && c.endedAt < input.editorStartedAt)
    .filter((c) => isInsideAnyFolder(c.cwd, input.workspaceFolders))
    .filter((c) => !input.runningSessionIds.has(c.sessionId))
    .filter((c) => !input.ignoredSessionIds.has(c.sessionId))
    .filter((c) => input.transcriptExists(c.transcriptPath))
    .map((c) => ({ ...c, ...(input.summarizeTranscript?.(c.transcriptPath) ?? {}) }))
    .sort(byEndTime);
};
