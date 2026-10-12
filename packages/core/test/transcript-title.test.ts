import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { displayName, summarizeTranscript, summarizeTranscriptText } from '../src/transcript-title';

const line = (record: object): string => `${JSON.stringify(record)}\n`;

describe('summarizeTranscriptText', () => {
  it('takes the last title and the last prompt', () => {
    const text =
      line({ type: 'ai-title', aiTitle: 'First title' }) +
      line({ type: 'last-prompt', lastPrompt: 'hello' }) +
      line({ type: 'user', message: {} }) +
      line({ type: 'ai-title', aiTitle: 'Cursor plugin test session' }) +
      line({ type: 'last-prompt', lastPrompt: 'write   something\n  here' });

    expect(summarizeTranscriptText(text)).toEqual({
      title: 'Cursor plugin test session',
      lastPrompt: 'write something here',
    });
  });

  it('shortens a long prompt and ignores empty values', () => {
    const text =
      line({ type: 'ai-title', aiTitle: '   ' }) +
      line({ type: 'last-prompt', lastPrompt: 'x'.repeat(100) });

    const summary = summarizeTranscriptText(text);

    expect(summary.title).toBeUndefined();
    expect(summary.lastPrompt).toHaveLength(60);
    expect(summary.lastPrompt?.endsWith('…')).toBe(true);
  });

  it('skips corrupt lines', () => {
    expect(summarizeTranscriptText('{bad\n' + line({ type: 'ai-title', aiTitle: 'ok' }))).toEqual({
      title: 'ok',
    });
  });
});

describe('summarizeTranscript', () => {
  it('reads only the tail of a large file and still finds the records', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-title-')), 't.jsonl');
    const filler = line({ type: 'assistant', message: 'y'.repeat(500) }).repeat(300);
    fs.writeFileSync(file, filler + line({ type: 'ai-title', aiTitle: 'Late title' }));

    expect(summarizeTranscript(file)).toEqual({ title: 'Late title' });
  });

  it('is empty for a missing file', () => {
    expect(summarizeTranscript('/nowhere/t.jsonl')).toEqual({});
  });
});

describe('displayName', () => {
  it.each([
    {
      session: { sessionId: 'abcdefgh-1', name: 'nfr-wave-2', title: 'T' },
      expected: 'nfr-wave-2',
    },
    {
      session: { sessionId: 'abcdefgh-1', title: 'Restoring sessions' },
      expected: 'Restoring sessions',
    },
    { session: { sessionId: 'abcdefgh-1' }, expected: 'claude abcdefgh' },
  ])('prefers the user name, then the title, then the id', ({ session, expected }) => {
    expect(displayName(session)).toBe(expected);
  });
});
