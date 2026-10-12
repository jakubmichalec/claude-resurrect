import { describe, expect, it } from 'vitest';
import { inWorkingDirectory, resumeCommand, shellQuote } from '../src/launch';

const settings = { claudeCommand: 'claude', extraArguments: [] };

describe('resumeCommand', () => {
  it('resumes by id with the configured command', () => {
    expect(resumeCommand(settings, 'abc')).toBe('claude -r abc');
  });

  it('appends extra arguments after the id', () => {
    const custom = { claudeCommand: '~/bin/claude', extraArguments: ['--permission-mode', 'plan'] };

    expect(resumeCommand(custom, 'abc')).toBe('~/bin/claude -r abc --permission-mode plan');
  });
});

describe('shellQuote', () => {
  it.each([
    { value: '/work/app', expected: "'/work/app'" },
    { value: '/work/my app', expected: "'/work/my app'" },
    { value: "/work/it's", expected: "'/work/it'\\''s'" },
  ])('quotes $value', ({ value, expected }) => {
    expect(shellQuote(value)).toBe(expected);
  });
});

describe('inWorkingDirectory', () => {
  it('changes directory before running the command', () => {
    expect(inWorkingDirectory('claude -r abc', '/work/app')).toBe(
      "cd '/work/app' && claude -r abc",
    );
  });
});
