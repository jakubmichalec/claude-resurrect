import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isRecord, parseJson, readTextFile, writeFileAtomically } from './io';

export type SessionStatus = 'active' | 'interrupted';

export interface SessionRecord {
  readonly sessionId: string;
  readonly cwd?: string;
  readonly transcriptPath?: string;
  readonly name?: string;
  // How Claude Code was launched, "cli" for a terminal session. Known only
  // when the registry could be read at the time of the event.
  readonly entrypoint?: string;
  readonly status: SessionStatus;
  readonly startedAt?: number;
  readonly source?: string;
  readonly endedAt?: number;
  readonly endReason?: string;
}

export type SessionMap = Readonly<Record<string, SessionRecord>>;

interface SessionEventBase {
  readonly ts: number;
  readonly sessionId: string;
  readonly cwd?: string;
  readonly transcriptPath?: string;
  readonly name?: string;
  readonly entrypoint?: string;
}

export interface StartEvent extends SessionEventBase {
  readonly event: 'start';
  readonly source?: string;
}

export interface EndEvent extends SessionEventBase {
  readonly event: 'end';
  readonly reason?: string;
}

export interface SnapshotEvent {
  readonly ts: number;
  readonly event: 'snapshot';
  readonly sessions: SessionMap;
}

export type ResurrectEvent = StartEvent | EndEvent | SnapshotEvent;

export interface PruneOptions {
  readonly now?: number;
  readonly maxInterruptedAgeMs?: number;
}

// SessionEnd reasons that mean the user deliberately closed the session.
// Everything else (notably "other", which is what a SIGHUP from the editor
// quitting produces) counts as an interruption worth restoring.
const USER_EXIT_REASONS = ['prompt_input_exit', 'clear', 'logout'] as const;

const EVENT_LOG_FILE_NAME = 'events.jsonl';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export const claudeConfigDirectory = (): string =>
  process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');

export const stateDirectory = (): string =>
  process.env.CLAUDE_RESURRECT_DIR ?? path.join(claudeConfigDirectory(), 'resurrect');

export const eventLogPath = (directory: string = stateDirectory()): string =>
  path.join(directory, EVENT_LOG_FILE_NAME);

// Claude Code stores transcripts under a directory named after the working
// directory with every character outside [A-Za-z0-9] replaced by a dash.
export const transcriptPathFor = (
  cwd: string,
  sessionId: string,
  configDirectory: string = claudeConfigDirectory(),
): string =>
  path.join(configDirectory, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${sessionId}.jsonl`);

// Only the discriminator, the timestamp and the session id are required when
// reading a line back. Older or partial lines with fewer details still count.
export const isResurrectEvent = (value: unknown): value is ResurrectEvent => {
  if (!isRecord(value) || typeof value.ts !== 'number') return false;
  if (value.event === 'snapshot') return isRecord(value.sessions);
  return (value.event === 'start' || value.event === 'end') && typeof value.sessionId === 'string';
};

// The log is append-only so that many sessions ending at the same moment
// (every terminal receives SIGHUP when the editor quits) never race on a
// read-modify-write of a shared state file.
export const appendEvent = (event: ResurrectEvent, directory: string = stateDirectory()): void => {
  fs.mkdirSync(directory, { recursive: true });
  fs.appendFileSync(eventLogPath(directory), `${JSON.stringify(event)}\n`);
};

export const readEvents = (logPath: string = eventLogPath()): readonly ResurrectEvent[] =>
  (readTextFile(logPath) ?? '')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map(parseJson)
    .filter(isResurrectEvent);

const isUserExit = (event: EndEvent): boolean =>
  USER_EXIT_REASONS.some((reason) => reason === event.reason);

// Optional fields resolved to undefined are dropped so the record round-trips
// through JSON unchanged. Only keys typed as optional can be undefined, so the
// shape is preserved and the assertion is sound.
const withoutUndefinedFields = (record: SessionRecord): SessionRecord =>
  Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as SessionRecord;

const sessionDetails = (event: StartEvent | EndEvent, existing: SessionRecord | undefined) => ({
  sessionId: event.sessionId,
  cwd: event.cwd ?? existing?.cwd,
  transcriptPath: event.transcriptPath ?? existing?.transcriptPath,
  name: event.name ?? existing?.name,
});

const startedSession = (event: StartEvent, existing: SessionRecord | undefined): SessionRecord =>
  withoutUndefinedFields({
    ...sessionDetails(event, existing),
    status: 'active',
    startedAt: event.ts,
    source: event.source,
  });

const interruptedSession = (event: EndEvent, existing: SessionRecord | undefined): SessionRecord =>
  withoutUndefinedFields({
    ...existing,
    ...sessionDetails(event, existing),
    status: 'interrupted',
    endedAt: event.ts,
    endReason: event.reason,
  });

const withoutSession = (sessions: SessionMap, sessionId: string): SessionMap =>
  Object.fromEntries(Object.entries(sessions).filter(([id]) => id !== sessionId));

const applyEvent = (sessions: SessionMap, event: ResurrectEvent): SessionMap => {
  switch (event.event) {
    case 'snapshot':
      return event.sessions;
    case 'start':
      return {
        ...sessions,
        [event.sessionId]: startedSession(event, sessions[event.sessionId]),
      };
    case 'end':
      return isUserExit(event)
        ? withoutSession(sessions, event.sessionId)
        : {
            ...sessions,
            [event.sessionId]: interruptedSession(event, sessions[event.sessionId]),
          };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
};

export const foldSessions = (events: readonly ResurrectEvent[]): SessionMap =>
  events.reduce(applyEvent, {});

export const loadSessions = (logPath: string = eventLogPath()): SessionMap =>
  foldSessions(readEvents(logPath));

export const isRestorable = (session: Pick<SessionRecord, 'status' | 'transcriptPath'>): boolean =>
  session.status === 'interrupted' &&
  session.transcriptPath !== undefined &&
  fs.existsSync(session.transcriptPath);

export const pruneStale = (
  sessions: SessionMap,
  { now = Date.now(), maxInterruptedAgeMs = THIRTY_DAYS_MS }: PruneOptions = {},
): SessionMap => {
  const isExpired = (session: SessionRecord): boolean =>
    session.status === 'interrupted' && now - (session.endedAt ?? 0) > maxInterruptedAgeMs;
  return Object.fromEntries(Object.entries(sessions).filter(([, session]) => !isExpired(session)));
};

// Collapses the log into a single snapshot line. An append that lands between
// the read and the rename would be lost, so only call this from a quiet
// moment (the editor on startup), never from inside a hook.
export const compact = (
  logPath: string = eventLogPath(),
  options: PruneOptions = {},
): SessionMap => {
  const sessions = pruneStale(loadSessions(logPath), options);
  const snapshot: SnapshotEvent = { ts: Date.now(), event: 'snapshot', sessions };
  writeFileAtomically(logPath, `${JSON.stringify(snapshot)}\n`);
  return sessions;
};
