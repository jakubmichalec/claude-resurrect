import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOST_REASON, recordLostSessions } from '../src/lost-sessions';
import { eventLogPath, readEvents } from '../src/state';
import type { RecordLostOptions } from '../src/lost-sessions';
import type { RegistryEntry } from '../src/registry';
import type { EndEvent, SessionMap } from '../src/state';

const NOW = 100_000;
const LONG_AGO = NOW - 60_000;
const JUST_NOW = NOW - 1000;

const dead = (sessionId: string, overrides: Partial<RegistryEntry> = {}): RegistryEntry => ({
  pid: 1,
  sessionId,
  cwd: '/work/app',
  entrypoint: 'cli',
  ...overrides,
});

const record = (options: RecordLostOptions) => {
  const appended: EndEvent[] = [];
  const events = recordLostSessions({
    endedAt: 5000,
    now: NOW,
    entries: [],
    running: new Set(),
    sessions: {},
    append: (event) => appended.push(event),
    ...options,
  });
  return { events, appended };
};

describe('recordLostSessions from the registry', () => {
  it('records a dead registry entry as interrupted with reason lost', () => {
    const { events, appended } = record({ entries: [dead('a')] });

    expect(appended).toEqual(events);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: 'end',
      sessionId: 'a',
      cwd: '/work/app',
      reason: LOST_REASON,
      ts: 5000,
      entrypoint: 'cli',
    });
    expect(events[0]?.transcriptPath).toMatch(/projects\/-work-app\/a\.jsonl$/);
  });

  it('skips sessions the hook already recorded as interrupted', () => {
    const sessions: SessionMap = { a: { sessionId: 'a', status: 'interrupted', endedAt: 1 } };

    expect(record({ entries: [dead('a')], sessions }).events).toEqual([]);
  });

  it('ignores entries without a working directory', () => {
    expect(record({ entries: [dead('a', { cwd: undefined })] }).events).toEqual([]);
  });

  it('keeps a user given name and drops a derived one', () => {
    const { events } = record({
      entries: [
        dead('a', { name: 'nfr-wave-2', nameSource: 'user' }),
        dead('b', { name: 'app-12', nameSource: 'derived' }),
      ],
    });

    expect(events[0]?.name).toBe('nfr-wave-2');
    expect(events[1]).not.toHaveProperty('name');
  });
});

describe('recordLostSessions with the real log', () => {
  it('appends lost events to the event log on disk', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-lost-'));
    process.env.CLAUDE_RESURRECT_DIR = directory;
    try {
      const events = recordLostSessions({
        endedAt: 5000,
        now: NOW,
        entries: [dead('a'), dead('b')],
        running: new Set(),
        sessions: {},
      });

      expect(events).toHaveLength(2);
      const recorded = readEvents(eventLogPath(directory)).flatMap((event) =>
        event.event === 'end' ? [event.sessionId] : [],
      );
      expect(recorded).toEqual(['a', 'b']);
    } finally {
      delete process.env.CLAUDE_RESURRECT_DIR;
    }
  });
});

describe('recordLostSessions from the log', () => {
  const active = (sessionId: string, startedAt: number): SessionMap[string] => ({
    sessionId,
    status: 'active',
    startedAt,
    cwd: '/work/app',
    transcriptPath: '/t/a.jsonl',
    name: 'thing',
  });

  it('records a session the log believes active when nothing runs it any more', () => {
    const { events } = record({ sessions: { a: active('a', LONG_AGO) } });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sessionId: 'a',
      reason: LOST_REASON,
      cwd: '/work/app',
      transcriptPath: '/t/a.jsonl',
      name: 'thing',
      ts: 5000,
    });
  });

  it('leaves a session alone while its process is running', () => {
    const { events } = record({ sessions: { a: active('a', LONG_AGO) }, running: new Set(['a']) });

    expect(events).toEqual([]);
  });

  it('gives a session that just started time to register', () => {
    const { events } = record({ sessions: { a: active('a', JUST_NOW) } });

    expect(events).toEqual([]);
  });

  it('does not record the same session twice when both sources know it', () => {
    const { events } = record({ entries: [dead('a')], sessions: { a: active('a', LONG_AGO) } });

    expect(events).toHaveLength(1);
  });
});
