// Reads Claude Code's live session registry to learn which sessions are
// running right now. The registry is an internal of Claude Code, so every
// read is best effort and an unreadable registry simply means "none known".

import * as fs from 'node:fs';
import * as path from 'node:path';
import { attempt, isOptionalString, isRecord, parseJson, readTextFile } from './io';
import { claudeConfigDirectory } from './state';

export interface RegistryEntry {
  readonly pid: number;
  readonly sessionId: string;
  readonly cwd?: string;
  readonly name?: string;
  readonly nameSource?: string;
  readonly entrypoint?: string;
}

const isRegistryEntry = (value: unknown): value is RegistryEntry =>
  isRecord(value) &&
  typeof value.pid === 'number' &&
  typeof value.sessionId === 'string' &&
  isOptionalString(value.cwd) &&
  isOptionalString(value.name) &&
  isOptionalString(value.nameSource) &&
  isOptionalString(value.entrypoint);

// Signal 0 performs only the permission check. EPERM means the process
// exists but belongs to someone else, which still counts as alive.
export const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isRecord(error) && error.code === 'EPERM';
  }
};

const registryDirectory = (configDirectory: string): string =>
  path.join(configDirectory, 'sessions');

export const readRegistryEntries = (
  configDirectory: string = claudeConfigDirectory(),
): readonly RegistryEntry[] =>
  (attempt(() => fs.readdirSync(registryDirectory(configDirectory))) ?? [])
    .filter((fileName) => fileName.endsWith('.json'))
    .map((fileName) =>
      attempt(() =>
        parseJson(readTextFile(path.join(registryDirectory(configDirectory), fileName)) ?? ''),
      ),
    )
    .filter(isRegistryEntry);

export const findRegistryEntry = (
  sessionId: string,
  configDirectory: string = claudeConfigDirectory(),
): RegistryEntry | undefined =>
  readRegistryEntries(configDirectory).find((entry) => entry.sessionId === sessionId);

// Entries whose process is gone belong to sessions that died without running
// their cleanup, for example a hard kill. Claude Code removes them about a
// second after any new session starts, so callers must act on them early.
export const deadRegistryEntries = (
  configDirectory: string = claudeConfigDirectory(),
  isAlive: (pid: number) => boolean = isProcessAlive,
): readonly RegistryEntry[] =>
  readRegistryEntries(configDirectory).filter((entry) => !isAlive(entry.pid));

export const runningSessionIds = (
  configDirectory: string = claudeConfigDirectory(),
  isAlive: (pid: number) => boolean = isProcessAlive,
): ReadonlySet<string> =>
  new Set(
    readRegistryEntries(configDirectory)
      .filter((entry) => isAlive(entry.pid))
      .map((entry) => entry.sessionId),
  );
