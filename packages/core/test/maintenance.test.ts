import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMPACTION_POLICY,
  compactLogIfQuiet,
  shouldCompact,
  toCompactionPolicy,
} from '../src/maintenance';
import { appendEvent, eventLogPath, readEvents } from '../src/state';

const LARGE = 300 * 1024;
const SMALL = 10;
const NOW = 1_000_000;
const QUIET_AGO = NOW - 120_000;
const JUST_NOW = NOW - 1000;
const ENABLED = { ...DEFAULT_COMPACTION_POLICY, enabled: true };

const temporaryDirectory = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-maint-'));

const ageFile = (filePath: string, ageMs: number): void => {
  const then = new Date(Date.now() - ageMs);
  fs.utimesSync(filePath, then, then);
};

describe('toCompactionPolicy', () => {
  it('converts the user facing units into bytes and milliseconds', () => {
    const policy = toCompactionPolicy({
      enabled: false,
      thresholdKb: 2,
      quietSeconds: 3,
      keepInterruptedDays: 1,
    });

    expect(policy).toEqual({
      enabled: false,
      thresholdBytes: 2048,
      quietPeriodMs: 3000,
      maxInterruptedAgeMs: 86_400_000,
    });
  });
});

describe('shouldCompact', () => {
  it.each([
    { label: 'a large quiet log', stats: { size: LARGE, mtimeMs: QUIET_AGO }, expected: true },
    { label: 'a large busy log', stats: { size: LARGE, mtimeMs: JUST_NOW }, expected: false },
    { label: 'a small quiet log', stats: { size: SMALL, mtimeMs: QUIET_AGO }, expected: false },
    { label: 'a missing log', stats: undefined, expected: false },
  ])('is $expected for $label when enabled', ({ stats, expected }) => {
    expect(shouldCompact(stats, NOW, ENABLED)).toBe(expected);
  });

  it('is off by default', () => {
    expect(DEFAULT_COMPACTION_POLICY.enabled).toBe(false);
    expect(shouldCompact({ size: LARGE, mtimeMs: QUIET_AGO }, NOW)).toBe(false);
  });

  it('honours a custom threshold and quiet period', () => {
    const eager = { ...ENABLED, thresholdBytes: 5, quietPeriodMs: 500 };

    expect(shouldCompact({ size: SMALL, mtimeMs: JUST_NOW }, NOW, eager)).toBe(true);
  });
});

describe('compactLogIfQuiet', () => {
  it('leaves a small log alone', () => {
    const directory = temporaryDirectory();
    appendEvent({ ts: 1, event: 'start', sessionId: 'a', cwd: '/w' }, directory);

    expect(compactLogIfQuiet(ENABLED, eventLogPath(directory))).toBe(false);
    expect(readEvents(eventLogPath(directory))).toHaveLength(1);
  });

  it('compacts a large log that has been quiet', () => {
    const directory = temporaryDirectory();
    const logPath = eventLogPath(directory);
    appendEvent({ ts: 1, event: 'start', sessionId: 'a', name: 'x'.repeat(LARGE) }, directory);
    appendEvent({ ts: 2, event: 'end', sessionId: 'a', reason: 'prompt_input_exit' }, directory);
    ageFile(logPath, 120_000);

    expect(compactLogIfQuiet(ENABLED, logPath)).toBe(true);
    const events = readEvents(logPath);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: 'snapshot', sessions: {} });
  });

  it('drops interrupted sessions older than the retention period while compacting', () => {
    const directory = temporaryDirectory();
    const logPath = eventLogPath(directory);
    const now = Date.now();
    const policy = { ...ENABLED, thresholdBytes: 1, maxInterruptedAgeMs: 1000 };
    appendEvent({ ts: now - 5000, event: 'end', sessionId: 'old', reason: 'other' }, directory);
    appendEvent({ ts: now - 500, event: 'end', sessionId: 'recent', reason: 'other' }, directory);
    ageFile(logPath, 120_000);

    compactLogIfQuiet(policy, logPath, now);

    const [snapshot] = readEvents(logPath);
    expect(snapshot?.event === 'snapshot' ? Object.keys(snapshot.sessions) : []).toEqual([
      'recent',
    ]);
  });
});
