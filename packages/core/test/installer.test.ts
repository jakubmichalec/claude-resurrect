import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyInstall, applyUninstall, buildCommand, readSettings } from '../src/installer';
import type { ClaudeSettings, HookEntry } from '../src/installer';

const INSTALLER_PATH = path.resolve(__dirname, '..', 'dist', 'install-hooks.js');
const command = buildCommand(
  '/usr/bin/node',
  '/opt/claude-resurrect/dist/claude-resurrect-hook.js',
);
const foreignHook: HookEntry = {
  matcher: 'Write',
  hooks: [{ type: 'command', command: '~/.claude/hooks/lint.sh' }],
};

const runInstaller = (...args: readonly string[]) =>
  spawnSync(process.execPath, [INSTALLER_PATH, ...args], { encoding: 'utf8' });

const temporaryDirectory = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-install-'));

describe('applyInstall', () => {
  it('adds one entry per event and keeps foreign hooks and settings', () => {
    const original: ClaudeSettings = {
      model: 'opus',
      hooks: { PreToolUse: [foreignHook], SessionStart: [foreignHook] },
    };

    const settings = applyInstall(original, command);

    expect(settings.model).toBe('opus');
    expect(settings.hooks?.PreToolUse).toEqual([foreignHook]);
    expect(settings.hooks?.SessionStart).toHaveLength(2);
    expect(settings.hooks?.SessionStart?.[1]?.hooks?.[0]?.command).toBe(command);
    expect(settings.hooks?.SessionEnd).toHaveLength(1);
  });

  it('is idempotent and updates the command path', () => {
    const first = applyInstall({}, command);
    const newCommand = buildCommand('/usr/local/bin/node', '/new/place/claude-resurrect-hook.js');

    const second = applyInstall(first, newCommand);

    expect(second.hooks?.SessionStart).toHaveLength(1);
    expect(second.hooks?.SessionEnd).toHaveLength(1);
    expect(second.hooks?.SessionStart?.[0]?.hooks?.[0]?.command).toBe(newCommand);
  });

  it('does not mutate the settings it was given', () => {
    const original: ClaudeSettings = { hooks: { SessionStart: [foreignHook] } };

    applyInstall(original, command);

    expect(original).toEqual({ hooks: { SessionStart: [foreignHook] } });
  });
});

describe('applyUninstall', () => {
  it('removes only our entries and drops emptied events', () => {
    const installed = applyInstall({ hooks: { SessionStart: [foreignHook] } }, command);

    expect(applyUninstall(installed).hooks).toEqual({ SessionStart: [foreignHook] });
  });

  it('removes the hooks key when nothing else remains', () => {
    expect(applyUninstall(applyInstall({ theme: 'dark' }, command))).toEqual({ theme: 'dark' });
  });

  it('leaves settings without hooks untouched', () => {
    const settings: ClaudeSettings = { theme: 'dark' };

    expect(applyUninstall(settings)).toBe(settings);
  });
});

describe('readSettings', () => {
  it('returns an empty object when the file is missing', () => {
    expect(readSettings(path.join(temporaryDirectory(), 'settings.json'))).toEqual({});
  });

  it('rejects a file that is not a settings object', () => {
    const settingsPath = path.join(temporaryDirectory(), 'settings.json');
    fs.writeFileSync(settingsPath, '[1, 2]');

    expect(() => readSettings(settingsPath)).toThrow(/not a valid Claude Code settings file/);
  });
});

describe('install-hooks CLI', () => {
  it('prints the merged settings on a dry run without writing', () => {
    const settingsPath = path.join(temporaryDirectory(), 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ theme: 'dark' }));

    const result = runInstaller('--settings', settingsPath, '--dry-run');

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ theme: 'dark', hooks: { SessionEnd: [{}] } });
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))).toEqual({ theme: 'dark' });
  });

  it('writes the settings file, keeps a backup, and can uninstall again', () => {
    const directory = temporaryDirectory();
    const settingsPath = path.join(directory, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ theme: 'dark' }));

    const install = runInstaller('--settings', settingsPath);

    expect(install.status, install.stderr).toBe(0);
    expect(readSettings(settingsPath)).toMatchObject({ theme: 'dark' });
    expect(readSettings(settingsPath).hooks?.SessionStart?.[0]?.hooks?.[0]?.command).toMatch(
      /dist\/claude-resurrect-hook\.js"$/,
    );
    expect(fs.readdirSync(directory).some((name) => name.startsWith('settings.json.bak-'))).toBe(
      true,
    );

    const uninstall = runInstaller('--settings', settingsPath, '--uninstall');

    expect(uninstall.status, uninstall.stderr).toBe(0);
    expect(readSettings(settingsPath)).toEqual({ theme: 'dark' });
  });

  it('fails with a message on an unknown flag', () => {
    const result = runInstaller('--bogus');

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/bogus/);
  });
});
