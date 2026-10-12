import { describe, expect, it } from 'vitest';
import {
  pickTerminalToReuse,
  reuseRank,
  terminalMatchesSession,
  terminalNameFor,
} from '../src/terminal-match';

const ID = '3a5dd9cf-c7c3-49a7-a8bb-fdd35f5a84bd';
const candidate = { sessionId: ID, cwd: '/work/app' };

describe('terminalNameFor', () => {
  it('uses the user given name when there is one', () => {
    expect(terminalNameFor({ sessionId: ID, name: 'nfr-wave-2' })).toBe('nfr-wave-2');
  });

  it('falls back to claude plus the short id', () => {
    expect(terminalNameFor({ sessionId: ID })).toBe('claude 3a5dd9cf');
  });

  it('uses the conversation title when there is no user name, cut to tab length', () => {
    expect(terminalNameFor({ sessionId: ID, title: 'Restoring sessions' })).toBe(
      'Restoring sessions',
    );
    expect(terminalNameFor({ sessionId: ID, title: 'x'.repeat(60) })).toHaveLength(40);
  });
});

describe('terminalMatchesSession', () => {
  it.each([
    { terminal: 'claude 3a5dd9cf', candidate: { sessionId: ID }, expected: true },
    { terminal: 'nfr-wave-2', candidate: { sessionId: ID, name: 'nfr-wave-2' }, expected: true },
    { terminal: '* nfr-wave-2', candidate: { sessionId: ID, name: 'nfr-wave-2' }, expected: true },
    { terminal: 'zsh - 3a5dd9cf', candidate: { sessionId: ID }, expected: true },
    { terminal: 'zsh', candidate: { sessionId: ID }, expected: false },
    { terminal: 'claude 11111111', candidate: { sessionId: ID }, expected: false },
    { terminal: '', candidate: { sessionId: ID, name: 'x' }, expected: false },
  ])('"$terminal" matches $candidate.sessionId: $expected', ({ terminal, candidate, expected }) => {
    expect(terminalMatchesSession(terminal, candidate)).toBe(expected);
  });
});

describe('reuseRank', () => {
  it.each([
    {
      label: 'a busy shell',
      terminal: { name: 'claude 3a5dd9cf', cwd: '/work/app', idle: false },
      expected: undefined,
    },
    {
      label: 'a matching name',
      terminal: { name: 'claude 3a5dd9cf', cwd: '/elsewhere', idle: true },
      expected: 0,
    },
    {
      label: 'an idle shell in the same folder',
      terminal: { name: 'zsh', cwd: '/work/app', idle: true },
      expected: 1,
    },
    {
      label: 'an idle shell with unknown folder',
      terminal: { name: 'zsh', cwd: undefined, idle: true },
      expected: 2,
    },
    {
      label: 'an idle shell in another folder',
      terminal: { name: 'zsh', cwd: '/other', idle: true },
      expected: undefined,
    },
  ])('ranks $label as $expected', ({ terminal, expected }) => {
    expect(reuseRank(terminal, candidate)).toBe(expected);
  });
});

describe('pickTerminalToReuse', () => {
  it('prefers the same folder over an unknown one and skips busy shells', () => {
    const terminals = [
      { name: 'zsh', cwd: undefined, idle: true, id: 'unknown' },
      { name: 'zsh', cwd: '/work/app', idle: false, id: 'busy' },
      { name: 'zsh', cwd: '/work/app', idle: true, id: 'same' },
    ];

    expect(pickTerminalToReuse(terminals, candidate)?.id).toBe('same');
  });

  it('returns nothing when every shell is busy or elsewhere', () => {
    const terminals = [
      { name: 'zsh', cwd: '/other', idle: true },
      { name: 'zsh', cwd: '/work/app', idle: false },
    ];

    expect(pickTerminalToReuse(terminals, candidate)).toBeUndefined();
  });
});
