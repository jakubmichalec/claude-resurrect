// Claude Code hook entry point for SessionStart and SessionEnd. It reads the
// hook payload from stdin and appends one event to the local log. It always
// exits 0: a failure here must never block or slow down a Claude session.

import * as fs from 'node:fs';
import { isHookPayload } from './hook-payload';
import type { HookPayload } from './hook-payload';
import { attempt, errorMessage, parseJson } from './io';
import { recordLostSessions } from './lost-sessions';
import { findRegistryEntry } from './registry';
import type { RegistryEntry } from './registry';
import { appendEvent } from './state';
import type { ResurrectEvent } from './state';

const STDIN_FILE_DESCRIPTOR = 0;

const readStdin = (): string => attempt(() => fs.readFileSync(STDIN_FILE_DESCRIPTOR, 'utf8')) ?? '';

// Best effort only: the sessions registry is a Claude Code internal and may
// not exist yet when SessionStart fires. The name is cosmetic; the entrypoint
// lets the editor leave sessions that did not run in a terminal alone.
const registryDetails = (sessionId: string): Pick<RegistryEntry, 'name' | 'entrypoint'> => {
  const entry = attempt(() => findRegistryEntry(sessionId));
  return {
    name: entry?.nameSource === 'user' ? entry.name : undefined,
    entrypoint: entry?.entrypoint,
  };
};

export const toEvent = (payload: HookPayload, now: number = Date.now()): ResurrectEvent => {
  const base = {
    ts: now,
    sessionId: payload.session_id,
    cwd: payload.cwd,
    transcriptPath: payload.transcript_path,
    ...registryDetails(payload.session_id),
  };
  switch (payload.hook_event_name) {
    case 'SessionStart':
      return { ...base, event: 'start', source: payload.source };
    case 'SessionEnd':
      return { ...base, event: 'end', reason: payload.reason };
    default: {
      const exhaustive: never = payload;
      return exhaustive;
    }
  }
};

const main = (): void => {
  const payload = parseJson(readStdin());
  if (!isHookPayload(payload)) return;
  appendEvent(toEvent(payload));
  // A new session is the moment Claude Code is about to purge dead registry
  // entries, so sessions that died without cleanup are recorded now. Nothing
  // here may stop the session's own event from being written first.
  if (payload.hook_event_name === 'SessionStart') attempt(() => recordLostSessions());
};

try {
  main();
} catch (error) {
  process.stderr.write(`claude-resurrect hook failed: ${errorMessage(error)}\n`);
}
process.exitCode = 0;
