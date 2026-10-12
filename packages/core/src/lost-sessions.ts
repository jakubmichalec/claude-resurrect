// A SessionEnd hook can be lost: a hard kill never runs it, and even a
// graceful quit can tear the hook down mid-write. Two other sources still
// know the truth. The registry lists sessions whose process is gone, and the
// log lists sessions it believes are active while nothing with that id is
// running any more. Both are recorded as interrupted with reason "lost".

import { deadRegistryEntries, runningSessionIds } from './registry';
import type { RegistryEntry } from './registry';
import { appendEvent, loadSessions, transcriptPathFor } from './state';
import type { EndEvent, SessionMap, SessionRecord } from './state';

export const LOST_REASON = 'lost';

// A session registers itself about half a second after it starts. One that
// started very recently may simply not be in the registry yet.
const STARTUP_GRACE_MS = 15 * 1000;

const optionalFields = (
  name: string | undefined,
  entrypoint: string | undefined,
): Pick<EndEvent, 'name' | 'entrypoint'> => ({
  ...(name === undefined ? {} : { name }),
  ...(entrypoint === undefined ? {} : { entrypoint }),
});

const fromRegistry = (entry: RegistryEntry, cwd: string, endedAt: number): EndEvent => ({
  ts: endedAt,
  event: 'end',
  sessionId: entry.sessionId,
  cwd,
  transcriptPath: transcriptPathFor(cwd, entry.sessionId),
  reason: LOST_REASON,
  ...optionalFields(entry.nameSource === 'user' ? entry.name : undefined, entry.entrypoint),
});

const fromLog = (session: SessionRecord, endedAt: number): EndEvent => ({
  ts: endedAt,
  event: 'end',
  sessionId: session.sessionId,
  reason: LOST_REASON,
  ...(session.cwd === undefined ? {} : { cwd: session.cwd }),
  ...(session.transcriptPath === undefined ? {} : { transcriptPath: session.transcriptPath }),
  ...optionalFields(session.name, session.entrypoint),
});

const isSilentlyDead = (
  session: SessionRecord,
  running: ReadonlySet<string>,
  now: number,
): boolean =>
  session.status === 'active' &&
  !running.has(session.sessionId) &&
  (session.startedAt ?? 0) < now - STARTUP_GRACE_MS;

export interface RecordLostOptions {
  // The moment the sessions are assumed to have died. The real time is
  // unknown, so the caller passes the latest instant that still counts as
  // "before this editor started".
  readonly endedAt?: number;
  readonly now?: number;
  readonly entries?: readonly RegistryEntry[];
  readonly running?: ReadonlySet<string>;
  readonly sessions?: SessionMap;
  readonly append?: (event: EndEvent) => void;
}

// Returns the sessions that were newly recorded as lost.
export const recordLostSessions = ({
  endedAt = Date.now(),
  now = Date.now(),
  entries = deadRegistryEntries(),
  running = runningSessionIds(),
  sessions = loadSessions(),
  append = appendEvent,
}: RecordLostOptions = {}): readonly EndEvent[] => {
  const fromDeadEntries = entries
    .filter(
      (entry) => entry.cwd !== undefined && sessions[entry.sessionId]?.status !== 'interrupted',
    )
    .map((entry) => fromRegistry(entry, entry.cwd ?? '', endedAt));
  const covered = new Set(fromDeadEntries.map((event) => event.sessionId));
  const fromActiveLog = Object.values(sessions)
    .filter((session) => !covered.has(session.sessionId) && isSilentlyDead(session, running, now))
    .map((session) => fromLog(session, endedAt));
  const events = [...fromDeadEntries, ...fromActiveLog];
  events.forEach((event) => append(event));
  return events;
};
