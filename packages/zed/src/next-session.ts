// Picks the session a freshly started shell should resume. The shell's
// folder plays the role the workspace folder plays in the editor extension,
// and "now" plays the role of the editor start: anything interrupted before
// this shell appeared is a candidate. An unattended resume ("always") only
// takes sessions from the latest shutdown, so an old leftover never starts
// on its own; a menu shows everything.

import { inWorkingDirectory, planRestore, resumeCommand } from '@claude-resurrect/core';
import type {
  LaunchSettings,
  RestoreCandidate,
  SessionMap,
  TranscriptSummary,
} from '@claude-resurrect/core';

export interface PendingInput {
  readonly sessions: SessionMap;
  readonly cwd: string;
  readonly runningSessionIds: ReadonlySet<string>;
  readonly declinedSessionIds: ReadonlySet<string>;
  readonly now: number;
  readonly transcriptExists: (transcriptPath: string) => boolean;
  // Shells report symlinked paths (/var on macOS is /private/var) while
  // Claude records resolved ones, so both sides go through the same function.
  readonly normalizePath?: (folder: string) => string;
  readonly summarizeTranscript?: (transcriptPath: string) => TranscriptSummary;
  readonly shutdownWindowMs?: number;
}

const withNormalizedFolders = (
  sessions: SessionMap,
  normalizePath: (folder: string) => string,
): SessionMap =>
  Object.fromEntries(
    Object.entries(sessions).map(([id, session]) => [
      id,
      session.cwd === undefined ? session : { ...session, cwd: normalizePath(session.cwd) },
    ]),
  );

export const pendingSessions = (input: PendingInput): readonly RestoreCandidate[] =>
  planRestore({
    sessions: withNormalizedFolders(input.sessions, input.normalizePath ?? ((f) => f)),
    workspaceFolders: [(input.normalizePath ?? ((f) => f))(input.cwd)],
    runningSessionIds: input.runningSessionIds,
    ignoredSessionIds: input.declinedSessionIds,
    editorStartedAt: input.now,
    ...(input.shutdownWindowMs === undefined ? {} : { shutdownWindowMs: input.shutdownWindowMs }),
    transcriptExists: input.transcriptExists,
    ...(input.summarizeTranscript === undefined
      ? {}
      : { summarizeTranscript: input.summarizeTranscript }),
  });

// The shell already sits in the session's folder in the common case; only a
// session from a subfolder needs the cd.
export const commandFor = (
  candidate: RestoreCandidate,
  shellCwd: string,
  launch: LaunchSettings,
): string => {
  const command = resumeCommand(launch, candidate.sessionId);
  return candidate.cwd === shellCwd ? command : inWorkingDirectory(command, candidate.cwd);
};
