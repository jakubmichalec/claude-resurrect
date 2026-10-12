import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { eventLogPath, readEvents } from '../src/state';

const HOOK_PATH = path.resolve(__dirname, '..', 'dist', 'claude-resurrect-hook.js');

const runHook = (input: string, directory: string) =>
  spawnSync(process.execPath, [HOOK_PATH], {
    input,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_RESURRECT_DIR: directory, CLAUDE_CONFIG_DIR: directory },
  });

const temporaryDirectory = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-hook-'));

const SESSION_ID = '11111111-1111-1111-1111-111111111111';

const startPayload = {
  session_id: SESSION_ID,
  transcript_path: '/transcripts/1.jsonl',
  cwd: '/work/project',
  hook_event_name: 'SessionStart',
  source: 'startup',
};

const endPayload = {
  session_id: SESSION_ID,
  transcript_path: '/transcripts/1.jsonl',
  cwd: '/work/project',
  hook_event_name: 'SessionEnd',
  reason: 'other',
};

const writeRegistryEntry = (
  directory: string,
  pid: number,
  entry: Readonly<Record<string, unknown>>,
): void => {
  fs.mkdirSync(path.join(directory, 'sessions'), { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'sessions', `${pid}.json`),
    JSON.stringify({ pid, ...entry }),
  );
};

describe('claude-resurrect hook', () => {
  it('appends a start event for SessionStart', () => {
    const directory = temporaryDirectory();

    const result = runHook(JSON.stringify(startPayload), directory);

    expect(result.status, result.stderr).toBe(0);
    const events = readEvents(eventLogPath(directory));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: 'start',
      sessionId: SESSION_ID,
      cwd: '/work/project',
      transcriptPath: '/transcripts/1.jsonl',
      source: 'startup',
    });
    expect(typeof events[0]?.ts).toBe('number');
  });

  it('appends an end event with the reason for SessionEnd', () => {
    const directory = temporaryDirectory();

    runHook(JSON.stringify(endPayload), directory);

    expect(readEvents(eventLogPath(directory))[0]).toMatchObject({ event: 'end', reason: 'other' });
  });

  it('picks up the user given session name from the registry', () => {
    const directory = temporaryDirectory();
    writeRegistryEntry(directory, 4242, {
      sessionId: SESSION_ID,
      name: 'nfr-wave-2',
      nameSource: 'user',
    });
    writeRegistryEntry(directory, 4343, {
      sessionId: 'someone-else',
      name: 'derived-x',
      nameSource: 'derived',
    });

    runHook(JSON.stringify(startPayload), directory);

    expect(readEvents(eventLogPath(directory))[0]).toMatchObject({ name: 'nfr-wave-2' });
  });

  it('ignores derived names', () => {
    const directory = temporaryDirectory();
    writeRegistryEntry(directory, 4242, {
      sessionId: SESSION_ID,
      name: 'project-ab',
      nameSource: 'derived',
    });

    runHook(JSON.stringify(startPayload), directory);

    expect(readEvents(eventLogPath(directory))[0]).not.toHaveProperty('name');
  });

  it.each([
    { label: 'empty input', input: '' },
    { label: 'non JSON input', input: 'not json' },
    { label: 'a payload without a session id', input: '{"hook_event_name":"SessionStart"}' },
    { label: 'an unrelated hook event', input: '{"session_id":"x","hook_event_name":"Stop"}' },
  ])('exits 0 and records nothing for $label', ({ input }) => {
    const directory = temporaryDirectory();

    const result = runHook(input, directory);

    expect(result.status).toBe(0);
    expect(fs.existsSync(eventLogPath(directory))).toBe(false);
  });
});
