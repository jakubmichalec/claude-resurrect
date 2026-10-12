import { describe, expect, it } from 'vitest';
import type { RestoreCandidate, SessionMap, SessionRecord } from '@claude-resurrect/core';
import { commandFor, pendingSessions } from '../src/next-session';

const id = (n: number): string => `0000000${n}-0000-4000-8000-000000000000`.slice(-36);
const NOW = 100_000;

const interrupted = (n: number, overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  sessionId: id(n),
  status: 'interrupted',
  cwd: '/work/app',
  transcriptPath: `/t/${id(n)}.jsonl`,
  endedAt: NOW - 1000,
  ...overrides,
});

const pending = (records: readonly SessionRecord[], overrides = {}) =>
  pendingSessions({
    sessions: Object.fromEntries(records.map((r) => [r.sessionId, r])) as SessionMap,
    cwd: '/work/app',
    runningSessionIds: new Set(),
    declinedSessionIds: new Set(),
    now: NOW,
    transcriptExists: () => true,
    ...overrides,
  }).map((c) => c.sessionId);

describe('pendingSessions', () => {
  it('offers interrupted sessions in the shell folder and below it', () => {
    const plan = pending([
      interrupted(1),
      interrupted(2, { cwd: '/work/app/packages/api' }),
      interrupted(3, { cwd: '/work/other' }),
    ]);

    expect(plan).toEqual([id(1), id(2)]);
  });

  it('compares folders through the given normaliser', () => {
    const plan = pending([interrupted(1, { cwd: '/private/work/app' })], {
      normalizePath: (folder: string) => folder.replace(/^\/private/, ''),
    });

    expect(plan).toEqual([id(1)]);
  });

  it('skips running and declined sessions', () => {
    const plan = pending([interrupted(1), interrupted(2), interrupted(3)], {
      runningSessionIds: new Set([id(1)]),
      declinedSessionIds: new Set([id(2)]),
    });

    expect(plan).toEqual([id(3)]);
  });
});

describe('commandFor', () => {
  const launch = { claudeCommand: 'claude', extraArguments: [] };
  const candidate = (cwd: string): RestoreCandidate => ({
    sessionId: id(1),
    cwd,
    transcriptPath: '/t/x.jsonl',
    endedAt: 1,
  });

  it('resumes in place when the shell is already in the session folder', () => {
    expect(commandFor(candidate('/work/app'), '/work/app', launch)).toBe(`claude -r ${id(1)}`);
  });

  it('changes into a subfolder first when needed', () => {
    expect(commandFor(candidate('/work/app/api'), '/work/app', launch)).toBe(
      `cd '/work/app/api' && claude -r ${id(1)}`,
    );
  });
});
