import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDeclined, writeDeclined } from '../src/declined';

const temporaryDirectory = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-zed-'));

describe('declined sessions', () => {
  it('is empty when nothing was written', () => {
    expect(readDeclined(temporaryDirectory()).size).toBe(0);
  });

  it('round trips and drops ids that no longer matter', () => {
    const directory = temporaryDirectory();

    writeDeclined(new Set(['keep', 'drop']), (id) => id === 'keep', directory);

    expect([...readDeclined(directory)]).toEqual(['keep']);
  });

  it('ignores a corrupt file', () => {
    const directory = temporaryDirectory();
    fs.writeFileSync(path.join(directory, 'zed-declined.json'), '{not json');

    expect(readDeclined(directory).size).toBe(0);
  });
});
