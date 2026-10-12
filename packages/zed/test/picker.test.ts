import { describe, expect, it } from 'vitest';
import type { RestoreCandidate } from '@claude-resurrect/core';
import { candidateLabel, menuText, parseChoice } from '../src/picker';

const candidate = (id: string, overrides: Partial<RestoreCandidate> = {}): RestoreCandidate => ({
  sessionId: `${id}-0000-4000-8000-000000000000`.slice(0, 36),
  cwd: '/work/app',
  transcriptPath: '/t/x.jsonl',
  endedAt: 0,
  ...overrides,
});

describe('menuText', () => {
  it('numbers the sessions and shows the folder only when it differs', () => {
    const text = menuText(
      [
        candidate('aaaaaaaa', { name: 'nfr-wave-2' }),
        candidate('bbbbbbbb', { cwd: '/work/app/api' }),
      ],
      '/work/app',
    );

    expect(text).toContain(' 1  nfr-wave-2');
    expect(text).toContain(' 2  claude bbbbbbbb');
    expect(
      menuText([candidate('cccccccc', { lastPrompt: 'fix the tests' })], '/work/app'),
    ).toContain('fix the tests');
    expect(text).toContain('/work/app/api');
    expect(text.split('\n').filter((line) => line.includes('/work/app'))).toHaveLength(1);
  });
});

describe('parseChoice', () => {
  it.each([
    { reply: '', count: 3, expected: 0 },
    { reply: '2', count: 3, expected: 1 },
    { reply: ' 3 ', count: 3, expected: 2 },
    { reply: '4', count: 3, expected: undefined },
    { reply: '0', count: 3, expected: undefined },
    { reply: 'q', count: 3, expected: undefined },
    { reply: 'n', count: 3, expected: undefined },
    { reply: 'abc', count: 3, expected: undefined },
    { reply: '', count: 0, expected: undefined },
  ])('"$reply" with $count sessions gives $expected', ({ reply, count, expected }) => {
    expect(parseChoice(reply, count)).toBe(expected);
  });
});

describe('candidateLabel', () => {
  it('prefers the user given name, then the conversation title', () => {
    expect(candidateLabel(candidate('aaaaaaaa', { name: 'x', title: 't' }))).toBe('x');
    expect(candidateLabel(candidate('aaaaaaaa', { title: 'Restoring sessions' }))).toBe(
      'Restoring sessions',
    );
    expect(candidateLabel(candidate('aaaaaaaa'))).toBe('claude aaaaaaaa');
  });
});
