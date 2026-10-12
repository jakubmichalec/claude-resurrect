import { describe, expect, it } from 'vitest';
import { isInsideAnyFolder, isSessionId, planRestore } from '../src/restore-plan';
import type { RestorePlanInput } from '../src/restore-plan';
import type { SessionMap, SessionRecord } from '../src/state';

const id = (n: number): string => `0000000${n}-0000-4000-8000-000000000000`.slice(-36);

const EDITOR_STARTED_AT = 100_000;
const WINDOW_MS = 10_000;

const interrupted = (n: number, overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  sessionId: id(n),
  status: 'interrupted',
  cwd: '/work/app',
  transcriptPath: `/transcripts/${id(n)}.jsonl`,
  endedAt: EDITOR_STARTED_AT - 1000,
  ...overrides,
});

const toMap = (records: readonly SessionRecord[]): SessionMap =>
  Object.fromEntries(records.map((record) => [record.sessionId, record]));

const input = (records: readonly SessionRecord[], overrides: Partial<RestorePlanInput> = {}) =>
  planRestore({
    sessions: toMap(records),
    workspaceFolders: ['/work/app'],
    runningSessionIds: new Set(),
    ignoredSessionIds: new Set(),
    editorStartedAt: EDITOR_STARTED_AT,
    shutdownWindowMs: WINDOW_MS,
    transcriptExists: () => true,
    ...overrides,
  });

const ids = (candidates: readonly { sessionId: string }[]): string[] =>
  candidates.map((c) => c.sessionId);

describe('planRestore', () => {
  it('offers interrupted sessions that belong to the window', () => {
    expect(ids(input([interrupted(1)]))).toEqual([id(1)]);
  });

  it('returns nothing when no session was interrupted', () => {
    expect(input([{ sessionId: id(1), status: 'active', cwd: '/work/app' }])).toEqual([]);
  });

  it('leaves out sessions whose cwd is outside every workspace folder', () => {
    const plan = input([interrupted(1), interrupted(2, { cwd: '/elsewhere' })]);

    expect(ids(plan)).toEqual([id(1)]);
  });

  it('matches a cwd nested inside a workspace folder but not a sibling with the same prefix', () => {
    const plan = input([
      interrupted(1, { cwd: '/work/app/packages/api' }),
      interrupted(2, { cwd: '/work/app-legacy' }),
    ]);

    expect(ids(plan)).toEqual([id(1)]);
  });

  it('skips sessions that are already running', () => {
    const plan = input([interrupted(1), interrupted(2)], { runningSessionIds: new Set([id(1)]) });

    expect(ids(plan)).toEqual([id(2)]);
  });

  it('skips sessions the user declined earlier', () => {
    const plan = input([interrupted(1), interrupted(2)], { ignoredSessionIds: new Set([id(2)]) });

    expect(ids(plan)).toEqual([id(1)]);
  });

  it('skips sessions whose transcript is gone', () => {
    const plan = input([interrupted(1), interrupted(2)], {
      transcriptExists: (p) => p.includes(id(2)),
    });

    expect(ids(plan)).toEqual([id(2)]);
  });

  it('only restores sessions killed by the same shutdown', () => {
    const shutdownAt = EDITOR_STARTED_AT - 1000;
    const plan = input([
      interrupted(1, { endedAt: shutdownAt }),
      interrupted(2, { endedAt: shutdownAt - WINDOW_MS + 1 }),
      interrupted(3, { endedAt: shutdownAt - WINDOW_MS - 1 }),
    ]);

    expect(ids(plan)).toEqual([id(2), id(1)]);
  });

  it('offers every earlier interruption when no shutdown window is given', () => {
    const shutdownAt = EDITOR_STARTED_AT - 1000;
    const plan = input(
      [
        interrupted(1, { endedAt: shutdownAt }),
        interrupted(2, { endedAt: shutdownAt - 3_600_000 }),
      ],
      { shutdownWindowMs: undefined },
    );

    expect(ids(plan)).toEqual([id(2), id(1)]);
  });

  it('anchors the shutdown on interruptions in other windows too', () => {
    const shutdownAt = EDITOR_STARTED_AT - 1000;
    const plan = input([
      interrupted(1, { endedAt: shutdownAt, cwd: '/other/window' }),
      interrupted(2, { endedAt: shutdownAt - WINDOW_MS - 1 }),
    ]);

    expect(plan).toEqual([]);
  });

  it('ignores interruptions that happened after the editor started', () => {
    const plan = input([
      interrupted(1, { endedAt: EDITOR_STARTED_AT + 5000 }),
      interrupted(2, { endedAt: EDITOR_STARTED_AT - 500 }),
    ]);

    expect(ids(plan)).toEqual([id(2)]);
  });

  it('sorts candidates by the time they were interrupted', () => {
    const plan = input([
      interrupted(1, { endedAt: EDITOR_STARTED_AT - 100 }),
      interrupted(2, { endedAt: EDITOR_STARTED_AT - 300 }),
      interrupted(3, { endedAt: EDITOR_STARTED_AT - 200 }),
    ]);

    expect(ids(plan)).toEqual([id(2), id(3), id(1)]);
  });

  it('leaves sessions that did not run in a terminal to their own front end', () => {
    const plan = input([
      interrupted(1, { entrypoint: 'cli' }),
      interrupted(2, { entrypoint: 'sdk-ts' }),
      interrupted(3),
    ]);

    expect(ids(plan)).toEqual([id(1), id(3)]);
  });

  it('attaches the transcript title and last prompt when a summariser is given', () => {
    const plan = input([interrupted(1)], {
      summarizeTranscript: () => ({ title: 'Restoring sessions', lastPrompt: 'go' }),
    });

    expect(plan[0]).toMatchObject({ title: 'Restoring sessions', lastPrompt: 'go' });
  });

  it('refuses ids that do not look like a Claude session id', () => {
    const plan = input([interrupted(1, { sessionId: 'x; rm -rf /' })]);

    expect(plan).toEqual([]);
  });
});

describe('isInsideAnyFolder', () => {
  it.each([
    { cwd: '/work/app', folders: ['/work/app'], expected: true },
    { cwd: '/work/app/sub', folders: ['/work/app'], expected: true },
    { cwd: '/work/app-two', folders: ['/work/app'], expected: false },
    { cwd: '/work', folders: ['/work/app'], expected: false },
    { cwd: '/work/app', folders: [], expected: false },
  ])('$cwd inside $folders is $expected', ({ cwd, folders, expected }) => {
    expect(isInsideAnyFolder(cwd, folders)).toBe(expected);
  });
});

describe('isSessionId', () => {
  it.each([
    { value: '3a5dd9cf-c7c3-49a7-a8bb-fdd35f5a84bd', expected: true },
    { value: '3A5DD9CF-C7C3-49A7-A8BB-FDD35F5A84BD', expected: true },
    { value: 'not-an-id', expected: false },
    { value: '3a5dd9cf-c7c3-49a7-a8bb-fdd35f5a84bd; echo', expected: false },
  ])('$value is $expected', ({ value, expected }) => {
    expect(isSessionId(value)).toBe(expected);
  });
});
