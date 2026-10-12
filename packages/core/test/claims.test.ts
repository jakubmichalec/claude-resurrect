import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { claimSession, pruneClaims } from '../src/claims';

const temporaryDirectory = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-claims-'));
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const ageFile = (filePath: string, ageMs: number): void => {
  const then = new Date(Date.now() - ageMs);
  fs.utimesSync(filePath, then, then);
};

describe('claimSession', () => {
  it('grants the first claim and refuses a second one right after', () => {
    const directory = temporaryDirectory();

    expect(claimSession('abc', 100, directory, 1000)).toBe(true);
    expect(claimSession('abc', 100, directory, 2000)).toBe(false);
  });

  it('treats the same session interrupted again as a new claim', () => {
    const directory = temporaryDirectory();
    claimSession('abc', 100, directory, 1000);

    expect(claimSession('abc', 200, directory, 2000)).toBe(true);
  });

  it('lets a stale claim be taken over', () => {
    const directory = temporaryDirectory();
    claimSession('abc', 100, directory, 1000);
    ageFile(path.join(directory, 'claims', 'abc-100.claim'), FIVE_MINUTES_MS + 1000);

    expect(claimSession('abc', 100, directory, Date.now())).toBe(true);
  });

  it('keeps claims for different sessions independent', () => {
    const directory = temporaryDirectory();

    expect(claimSession('one', 100, directory)).toBe(true);
    expect(claimSession('two', 100, directory)).toBe(true);
  });
});

describe('pruneClaims', () => {
  it('removes claim files older than a day and keeps recent ones', () => {
    const directory = temporaryDirectory();
    claimSession('old', 100, directory);
    claimSession('recent', 100, directory);
    ageFile(path.join(directory, 'claims', 'old-100.claim'), ONE_DAY_MS + 1000);

    expect(pruneClaims(directory)).toBe(1);
    expect(fs.readdirSync(path.join(directory, 'claims'))).toEqual(['recent-100.claim']);
  });

  it('does nothing when there is no claims directory', () => {
    expect(pruneClaims(temporaryDirectory())).toBe(0);
  });
});
