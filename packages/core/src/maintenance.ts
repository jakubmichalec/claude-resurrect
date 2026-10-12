// Keeps the event log from growing without bound. Compaction rewrites the
// file, which could swallow an append that lands at the same moment, so it
// only runs when the log is both large and has been quiet for a while.

import type * as fs from 'node:fs';
import * as nodeFs from 'node:fs';
import { attempt } from './io';
import { compact, eventLogPath } from './state';

const KILOBYTE = 1024;
const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * MILLISECONDS_PER_SECOND;

export interface CompactionPolicy {
  readonly enabled: boolean;
  readonly thresholdBytes: number;
  readonly quietPeriodMs: number;
  readonly maxInterruptedAgeMs: number;
}

export interface CompactionSettings {
  readonly enabled: boolean;
  readonly thresholdKb: number;
  readonly quietSeconds: number;
  readonly keepInterruptedDays: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: false,
  thresholdKb: 256,
  quietSeconds: 60,
  keepInterruptedDays: 30,
};

export const toCompactionPolicy = (settings: CompactionSettings): CompactionPolicy => ({
  enabled: settings.enabled,
  thresholdBytes: settings.thresholdKb * KILOBYTE,
  quietPeriodMs: settings.quietSeconds * MILLISECONDS_PER_SECOND,
  maxInterruptedAgeMs: settings.keepInterruptedDays * MILLISECONDS_PER_DAY,
});

export const DEFAULT_COMPACTION_POLICY = toCompactionPolicy(DEFAULT_COMPACTION_SETTINGS);

export const shouldCompact = (
  stats: Pick<fs.Stats, 'size' | 'mtimeMs'> | undefined,
  now: number,
  policy: CompactionPolicy = DEFAULT_COMPACTION_POLICY,
): boolean =>
  policy.enabled &&
  stats !== undefined &&
  stats.size > policy.thresholdBytes &&
  now - stats.mtimeMs > policy.quietPeriodMs;

export const compactLogIfQuiet = (
  policy: CompactionPolicy = DEFAULT_COMPACTION_POLICY,
  logPath: string = eventLogPath(),
  now: number = Date.now(),
): boolean => {
  if (
    !shouldCompact(
      attempt(() => nodeFs.statSync(logPath)),
      now,
      policy,
    )
  )
    return false;
  return (
    attempt(() => {
      compact(logPath, { now, maxInterruptedAgeMs: policy.maxInterruptedAgeMs });
      return true;
    }) ?? false
  );
};
