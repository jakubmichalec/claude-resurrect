import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appendEvent,
  compact,
  eventLogPath,
  foldSessions,
  isRestorable,
  pruneStale,
  readEvents,
  transcriptPathFor,
} from '../src/state';
import type { EndEvent, SessionMap, SnapshotEvent, StartEvent } from '../src/state';

const start = (sessionId: string, overrides: Partial<StartEvent> = {}): StartEvent => ({
  ts: 1000,
  event: 'start',
  sessionId,
  cwd: '/work/project',
  transcriptPath: `/transcripts/${sessionId}.jsonl`,
  source: 'startup',
  ...overrides,
});

const end = (sessionId: string, reason: string, overrides: Partial<EndEvent> = {}): EndEvent => ({
  ts: 2000,
  event: 'end',
  sessionId,
  reason,
  ...overrides,
});

const temporaryDirectory = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-'));

describe('foldSessions', () => {
  it('marks a started session active', () => {
    const sessions = foldSessions([start('a')]);

    expect(sessions.a).toMatchObject({ status: 'active', cwd: '/work/project' });
  });

  it.each(['prompt_input_exit', 'clear', 'logout'])(
    'drops the session when it ends with reason %s',
    (reason) => {
      expect(foldSessions([start('a'), end('a', reason)])).toEqual({});
    },
  );

  it('marks the session interrupted when it ends with reason other', () => {
    const sessions = foldSessions([start('a'), end('a', 'other')]);

    expect(sessions.a).toMatchObject({
      status: 'interrupted',
      endReason: 'other',
      endedAt: 2000,
      transcriptPath: '/transcripts/a.jsonl',
    });
  });

  it('treats an unknown end reason as an interruption', () => {
    const sessions = foldSessions([start('a'), end('a', 'something_new')]);

    expect(sessions.a?.status).toBe('interrupted');
  });

  it('records an interrupted entry for an end without a start', () => {
    const sessions = foldSessions([
      end('a', 'other', { cwd: '/elsewhere', transcriptPath: '/t/a.jsonl' }),
    ]);

    expect(sessions.a).toMatchObject({ status: 'interrupted', cwd: '/elsewhere' });
  });

  it('makes a resumed session active again', () => {
    const sessions = foldSessions([
      start('a'),
      end('a', 'other'),
      start('a', { ts: 3000, source: 'resume' }),
    ]);

    expect(sessions.a).toMatchObject({ status: 'active', source: 'resume' });
    expect(sessions.a?.endedAt).toBeUndefined();
  });

  it('replaces everything recorded before a snapshot', () => {
    const snapshot: SnapshotEvent = {
      ts: 1500,
      event: 'snapshot',
      sessions: { b: { sessionId: 'b', status: 'interrupted' } },
    };

    const sessions = foldSessions([start('a'), snapshot, start('c')]);

    expect(Object.keys(sessions).sort()).toEqual(['b', 'c']);
  });

  it('keeps the user given name across an end event without one', () => {
    const sessions = foldSessions([start('a', { name: 'nfr-wave-2' }), end('a', 'other')]);

    expect(sessions.a?.name).toBe('nfr-wave-2');
  });

  it('never stores undefined fields', () => {
    const sessions = foldSessions([end('a', 'other')]);

    expect(Object.values(sessions.a ?? {})).not.toContain(undefined);
  });

  it('does not mutate the map it was given', () => {
    const frozen: SessionMap = Object.freeze({ a: { sessionId: 'a', status: 'active' } });
    const snapshot: SnapshotEvent = { ts: 500, event: 'snapshot', sessions: frozen };

    const sessions = foldSessions([snapshot, start('b'), end('a', 'other')]);

    expect(Object.keys(sessions).sort()).toEqual(['a', 'b']);
    expect(frozen).toEqual({ a: { sessionId: 'a', status: 'active' } });
  });
});

describe('transcriptPathFor', () => {
  it.each([
    { cwd: '/Users/me/code/app', expected: '-Users-me-code-app' },
    { cwd: '/Users/me/code/eatc_project', expected: '-Users-me-code-eatc-project' },
    {
      cwd: '/Users/me/code/strapi-projects/plugins',
      expected: '-Users-me-code-strapi-projects-plugins',
    },
  ])('encodes $cwd as $expected', ({ cwd, expected }) => {
    expect(transcriptPathFor(cwd, 'abc', '/cfg')).toBe(`/cfg/projects/${expected}/abc.jsonl`);
  });
});

describe('readEvents', () => {
  it('returns an empty list when the log does not exist', () => {
    expect(readEvents(eventLogPath(temporaryDirectory()))).toEqual([]);
  });

  it('skips torn and foreign lines', () => {
    const directory = temporaryDirectory();
    appendEvent(start('a'), directory);
    fs.appendFileSync(eventLogPath(directory), '{"event":"start","sessionId":"torn\n');
    fs.appendFileSync(eventLogPath(directory), '{"event":"unknown","ts":1,"sessionId":"x"}\n');
    appendEvent(end('a', 'other'), directory);

    expect(readEvents(eventLogPath(directory))).toHaveLength(2);
  });
});

describe('isRestorable', () => {
  it('requires an interrupted session whose transcript exists', () => {
    const transcriptPath = path.join(temporaryDirectory(), 'a.jsonl');

    expect(isRestorable({ status: 'interrupted', transcriptPath })).toBe(false);
    fs.writeFileSync(transcriptPath, '');
    expect(isRestorable({ status: 'interrupted', transcriptPath })).toBe(true);
    expect(isRestorable({ status: 'active', transcriptPath })).toBe(false);
  });
});

describe('pruneStale', () => {
  it('drops interrupted sessions older than the limit but keeps active ones', () => {
    const sessions: SessionMap = {
      old: { sessionId: 'old', status: 'interrupted', endedAt: 0 },
      fresh: { sessionId: 'fresh', status: 'interrupted', endedAt: 900 },
      live: { sessionId: 'live', status: 'active', startedAt: 0 },
    };

    const kept = pruneStale(sessions, { now: 1000, maxInterruptedAgeMs: 500 });

    expect(Object.keys(kept).sort()).toEqual(['fresh', 'live']);
  });
});

describe('compact', () => {
  it('collapses the log into one snapshot with the same folded state', () => {
    const directory = temporaryDirectory();
    appendEvent(start('a'), directory);
    appendEvent(end('a', 'other'), directory);
    appendEvent(start('b'), directory);
    appendEvent(end('b', 'prompt_input_exit'), directory);

    const sessions = compact(eventLogPath(directory), { now: 3000 });

    const events = readEvents(eventLogPath(directory));
    expect(Object.keys(sessions)).toEqual(['a']);
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe('snapshot');
    expect(foldSessions(events)).toEqual(sessions);
  });
});
