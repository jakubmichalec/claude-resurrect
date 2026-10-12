import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deadRegistryEntries,
  findRegistryEntry,
  isProcessAlive,
  runningSessionIds,
} from '../src/registry';

const temporaryConfigDirectory = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-registry-'));
  fs.mkdirSync(path.join(directory, 'sessions'));
  return directory;
};

const writeEntry = (directory: string, fileName: string, content: string): void =>
  fs.writeFileSync(path.join(directory, 'sessions', fileName), content);

describe('runningSessionIds', () => {
  it('lists sessions whose process is alive', () => {
    const directory = temporaryConfigDirectory();
    writeEntry(directory, '10.json', JSON.stringify({ pid: 10, sessionId: 'alive' }));
    writeEntry(directory, '20.json', JSON.stringify({ pid: 20, sessionId: 'dead' }));

    const running = runningSessionIds(directory, (pid) => pid === 10);

    expect([...running]).toEqual(['alive']);
  });

  it('ignores malformed and non JSON files', () => {
    const directory = temporaryConfigDirectory();
    writeEntry(directory, '10.json', '{not json');
    writeEntry(directory, '20.json', JSON.stringify({ sessionId: 'no pid' }));
    writeEntry(directory, '30.key', 'secret');

    expect(runningSessionIds(directory, () => true).size).toBe(0);
  });

  it('treats a missing registry as no running sessions', () => {
    expect(runningSessionIds(path.join(os.tmpdir(), 'does-not-exist'), () => true).size).toBe(0);
  });
});

describe('deadRegistryEntries', () => {
  it('returns the entries whose process is gone, with their details', () => {
    const directory = temporaryConfigDirectory();
    writeEntry(
      directory,
      '10.json',
      JSON.stringify({ pid: 10, sessionId: 'alive', cwd: '/a', entrypoint: 'cli' }),
    );
    writeEntry(
      directory,
      '20.json',
      JSON.stringify({ pid: 20, sessionId: 'dead', cwd: '/d', entrypoint: 'cli', name: 'x' }),
    );

    expect(deadRegistryEntries(directory, (pid) => pid === 10)).toEqual([
      { pid: 20, sessionId: 'dead', cwd: '/d', entrypoint: 'cli', name: 'x' },
    ]);
  });
});

describe('findRegistryEntry', () => {
  it('finds an entry by session id', () => {
    const directory = temporaryConfigDirectory();
    writeEntry(directory, '10.json', JSON.stringify({ pid: 10, sessionId: 'abc', name: 'n' }));

    expect(findRegistryEntry('abc', directory)?.name).toBe('n');
    expect(findRegistryEntry('zzz', directory)).toBeUndefined();
  });
});

describe('isProcessAlive', () => {
  it('is true for the current process and false for an impossible pid', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(2 ** 22 - 1)).toBe(false);
  });
});
