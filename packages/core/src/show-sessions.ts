// Prints the folded session state, for debugging what the hooks recorded.

import { eventLogPath, isRestorable, loadSessions } from './state';
import type { SessionRecord } from './state';

const STATUS_COLUMN_WIDTH = 11;

const formatSession = (session: SessionRecord): string => {
  const status = isRestorable(session) ? 'restorable' : session.status;
  const when = new Date(session.endedAt ?? session.startedAt ?? 0).toISOString();
  const label = session.name === undefined ? '' : ` (${session.name})`;
  return `${status.padEnd(STATUS_COLUMN_WIDTH)} ${when} ${session.sessionId}${label}\n  ${session.cwd ?? '?'}`;
};

const sessions = Object.values(loadSessions());
const output =
  sessions.length === 0
    ? `No sessions recorded yet in ${eventLogPath()}`
    : sessions.map(formatSession).join('\n');
process.stdout.write(`${output}\n`);
