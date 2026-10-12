import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendEvent, eventLogPath, readEvents } from '@claude-resurrect/core';

const CLI = path.resolve(__dirname, '..', 'dist', 'cli.js');
const SESSION_ID = '3a5dd9cf-c7c3-49a7-a8bb-fdd35f5a84bd';

interface Sandbox {
  readonly root: string;
  readonly stateDirectory: string;
  readonly configDirectory: string;
  readonly project: string;
}

const sandbox = (): Sandbox => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-cli-'));
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  return {
    root,
    stateDirectory: path.join(root, 'state'),
    configDirectory: path.join(root, 'claude'),
    project,
  };
};

const run = (box: Sandbox, ...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    cwd: box.project,
    env: {
      ...process.env,
      CLAUDE_RESURRECT_DIR: box.stateDirectory,
      CLAUDE_CONFIG_DIR: box.configDirectory,
      XDG_CONFIG_HOME: path.join(box.root, 'xdg'),
      HOME: box.root,
      SHELL: '/bin/zsh',
    },
  });

const SECOND_SESSION_ID = '4b6ee0a0-1111-4111-8111-111111111111';

const recordInterrupted = (box: Sandbox, sessionId = SESSION_ID, ageMs = 30_000): void => {
  const transcriptPath = path.join(box.root, `${sessionId}.jsonl`);
  fs.writeFileSync(transcriptPath, '');
  const now = Date.now();
  appendEvent(
    { ts: now - ageMs - 30_000, event: 'start', sessionId, cwd: box.project, transcriptPath },
    box.stateDirectory,
  );
  appendEvent({ ts: now - ageMs, event: 'end', sessionId, reason: 'other' }, box.stateDirectory);
};

describe('claude-resurrect-zed', () => {
  it('prints usage without a command', () => {
    const result = run(sandbox());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('shell-init');
  });

  it('prints the shell snippet', () => {
    const result = run(sandbox(), 'shell-init', '--mode', 'always');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('next --mode always');
  });

  it('resumes the pending session once in always mode, then nothing', () => {
    const box = sandbox();
    recordInterrupted(box);

    const first = run(box, 'next', '--mode', 'always');
    const second = run(box, 'next', '--mode', 'always');

    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout.trim()).toBe(`claude -r ${SESSION_ID}`);
    expect(second.stdout).toBe('');
  });

  it('prints nothing in never mode and when nothing is pending', () => {
    const box = sandbox();
    recordInterrupted(box);

    expect(run(box, 'next', '--mode', 'never').stdout).toBe('');
    expect(run(sandbox(), 'next', '--mode', 'always').stdout).toBe('');
  });

  it('puts the resume command in the line for one session and the picker for several', () => {
    const box = sandbox();
    recordInterrupted(box);

    expect(run(box, 'line', '--mode', 'ask').stdout.trim()).toBe(`claude -r ${SESSION_ID}`);

    const two = sandbox();
    recordInterrupted(two);
    recordInterrupted(two, SECOND_SESSION_ID, 10_000);

    expect(run(two, 'line', '--mode', 'ask').stdout.trim()).toBe('claude-resurrect-zed pick');
    expect(run(two, 'line', '--mode', 'always').stdout.trim()).toBe(`claude -r ${SESSION_ID}`);
    expect(run(two, 'line', '--mode', 'never').stdout).toBe('');
  });

  it('gives two tabs starting together two different sessions in always mode', () => {
    const box = sandbox();
    recordInterrupted(box, SESSION_ID, 20_000);
    recordInterrupted(box, SECOND_SESSION_ID, 10_000);

    const first = run(box, 'line', '--mode', 'always').stdout.trim();
    const second = run(box, 'line', '--mode', 'always').stdout.trim();
    const third = run(box, 'line', '--mode', 'always').stdout.trim();

    expect([first, second].sort()).toEqual(
      [`claude -r ${SESSION_ID}`, `claude -r ${SECOND_SESSION_ID}`].sort(),
    );
    expect(third).toBe('');
  });

  it('takes only the latest shutdown in always mode but offers everything to the menu', () => {
    const box = sandbox();
    recordInterrupted(box, SESSION_ID, 3_600_000);
    recordInterrupted(box, SECOND_SESSION_ID, 10_000);

    expect(run(box, 'line', '--mode', 'always').stdout.trim()).toBe(
      `claude -r ${SECOND_SESSION_ID}`,
    );
    expect(run(box, 'line', '--mode', 'always').stdout).toBe('');
    expect(run(box, 'pick', '--choose', '1', '--print').stdout.trim()).toBe(
      `claude -r ${SESSION_ID}`,
    );
  });

  it('forgets sessions by id prefix or all at once', () => {
    const box = sandbox();
    recordInterrupted(box);
    recordInterrupted(box, SECOND_SESSION_ID, 10_000);

    expect(run(box, 'forget', SESSION_ID.slice(0, 8)).stdout).toContain('Forgot 1');
    expect(run(box, 'pending').stdout).not.toContain(SESSION_ID);
    expect(run(box, 'forget', '--all').stdout).toContain('Forgot 1');
    expect(run(box, 'pending').stdout).toContain('No pending');
    expect(run(box, 'forget', 'zzz').stdout).toContain('Nothing matched');
  });

  it('picks a session by number and prints its command', () => {
    const box = sandbox();
    recordInterrupted(box);
    recordInterrupted(box, SECOND_SESSION_ID, 10_000);

    const second = run(box, 'pick', '--choose', '2', '--print');

    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout.trim()).toBe(`claude -r ${SECOND_SESSION_ID}`);
    expect(run(box, 'pick', '--choose', '2', '--print').stdout).toContain('already being resumed');
  });

  it('refuses to show the menu without a terminal', () => {
    const box = sandbox();
    recordInterrupted(box);
    recordInterrupted(box, SECOND_SESSION_ID, 10_000);

    const result = run(box, 'pick', '--print');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('needs a terminal');
  });

  it('summarises pending sessions for hint mode and stays silent otherwise', () => {
    const box = sandbox();

    expect(run(box, 'summary').stdout).toBe('');
    recordInterrupted(box);
    recordInterrupted(box, SECOND_SESSION_ID, 10_000);

    const summary = run(box, 'summary', '--key', 'cmd-shift-x').stdout;

    expect(summary).toContain('2 sessions pending here');
    expect(summary).toContain('cmd-shift-x');
    expect(run(box, 'line', '--mode', 'hint').stdout).toBe('');
  });

  it('lists pending sessions', () => {
    const box = sandbox();
    recordInterrupted(box);

    const result = run(box, 'pending');

    expect(result.stdout).toContain(SESSION_ID);
  });

  it('records a session as lost when the log believes it active but nothing runs it', () => {
    const box = sandbox();
    const transcriptPath = path.join(box.root, 'transcript.jsonl');
    fs.writeFileSync(transcriptPath, '');
    appendEvent(
      {
        ts: Date.now() - 60_000,
        event: 'start',
        sessionId: SESSION_ID,
        cwd: box.project,
        transcriptPath,
      },
      box.stateDirectory,
    );

    const result = run(box, 'next', '--mode', 'always');

    expect(result.stdout.trim()).toBe(`claude -r ${SESSION_ID}`);
    expect(readEvents(eventLogPath(box.stateDirectory)).some((e) => e.event === 'end')).toBe(true);
  });

  it('installs and removes the Zed task idempotently', () => {
    const box = sandbox();
    const tasksPath = path.join(box.root, 'xdg', 'zed', 'tasks.json');
    fs.mkdirSync(path.dirname(tasksPath), { recursive: true });
    fs.writeFileSync(tasksPath, JSON.stringify([{ label: 'npm test', command: 'npm' }]));

    expect(run(box, 'install-task', '--mode', 'always').status).toBe(0);
    expect(run(box, 'install-task').status).toBe(0);
    const installed = JSON.parse(fs.readFileSync(tasksPath, 'utf8')) as { label: string }[];
    expect(installed.map((t) => t.label)).toEqual(['npm test', 'Claude Resurrect: next session']);

    expect(run(box, 'uninstall-task').status).toBe(0);
    const removed = JSON.parse(fs.readFileSync(tasksPath, 'utf8')) as { label: string }[];
    expect(removed.map((t) => t.label)).toEqual(['npm test']);
  });

  it('refuses to rewrite a tasks file it cannot parse', () => {
    const box = sandbox();
    const tasksPath = path.join(box.root, 'xdg', 'zed', 'tasks.json');
    fs.mkdirSync(path.dirname(tasksPath), { recursive: true });
    fs.writeFileSync(tasksPath, '// comment\n[]');

    const result = run(box, 'install-task');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not a plain JSON array');
    expect(fs.readFileSync(tasksPath, 'utf8')).toBe('// comment\n[]');
  });

  it('sets everything up in one go and tears it down again', () => {
    const box = sandbox();
    const rcPath = path.join(box.root, '.zshrc');
    const keymapPath = path.join(box.root, 'xdg', 'zed', 'keymap.json');
    const tasksPath = path.join(box.root, 'xdg', 'zed', 'tasks.json');
    const settingsPath = path.join(box.configDirectory, 'settings.json');
    fs.writeFileSync(rcPath, 'export FOO=1\n');

    const setup = run(box, 'setup', '--key', 'cmd-shift-x');

    expect(setup.status, setup.stderr).toBe(0);
    expect(fs.readFileSync(rcPath, 'utf8')).toContain('eval "$(claude-resurrect-zed shell-init)"');
    expect(fs.readFileSync(keymapPath, 'utf8')).toContain('"cmd-shift-x"');
    expect(fs.readFileSync(tasksPath, 'utf8')).toContain('Claude Resurrect: next session');
    expect(fs.readFileSync(settingsPath, 'utf8')).toContain('claude-resurrect-hook.js');

    const again = run(box, 'setup');
    expect(again.stdout.match(/already set up/g)).toHaveLength(2);

    const switched = run(box, 'setup', '--mode', 'always');
    expect(switched.status, switched.stderr).toBe(0);
    expect(fs.readFileSync(rcPath, 'utf8')).toContain('shell-init --mode always');
    expect(fs.readFileSync(rcPath, 'utf8').match(/>>> claude-resurrect >>>/g)).toHaveLength(1);

    const teardown = run(box, 'teardown');
    expect(teardown.status, teardown.stderr).toBe(0);
    expect(fs.readFileSync(rcPath, 'utf8')).toBe('export FOO=1\n');
    expect(fs.readFileSync(keymapPath, 'utf8')).not.toContain('cmd-shift-x');
    expect(JSON.parse(fs.readFileSync(tasksPath, 'utf8'))).toEqual([]);
    expect(fs.readFileSync(settingsPath, 'utf8')).not.toContain('claude-resurrect-hook.js');
  });

  it('explains the shell guards and lists pending sessions in doctor', () => {
    const box = sandbox();
    recordInterrupted(box);

    const result = run(box, 'doctor');

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('TERM_PROGRAM is zed:        no');
    expect(result.stdout).toContain('Pending for this folder: 1');
    expect(result.stdout).toContain(SESSION_ID.slice(0, 8));
  });

  it('rejects an unknown mode', () => {
    const result = run(sandbox(), 'next', '--mode', 'maybe');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--mode');
  });
});
