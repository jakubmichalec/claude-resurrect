// Merges the claude-resurrect hook into Claude Code's user settings, or
// removes it again. Both operations return a new settings object, are
// idempotent, and leave every other hook untouched.

import * as fs from 'node:fs';
import { HOOK_EVENTS, isHookEventName } from './hook-payload';
import { isRecord, parseJson, readTextFile, writeFileAtomically } from './io';

export const HOOK_FILE_NAME = 'claude-resurrect-hook.js';
const HOOK_TIMEOUT_SECONDS = 10;
const SETTINGS_JSON_INDENT = 2;

export interface HookCommand {
  readonly type: string;
  readonly command?: string;
  readonly timeout?: number;
}

export interface HookEntry {
  readonly matcher?: string;
  readonly hooks?: readonly HookCommand[];
}

export type HookRegistry = Readonly<Record<string, readonly HookEntry[]>>;

export interface ClaudeSettings {
  readonly hooks?: HookRegistry;
  readonly [key: string]: unknown;
}

const isHookRegistry = (value: unknown): value is HookRegistry =>
  isRecord(value) &&
  Object.values(value).every((entries) => Array.isArray(entries) && entries.every(isRecord));

export const isClaudeSettings = (value: unknown): value is ClaudeSettings =>
  isRecord(value) && (value.hooks === undefined || isHookRegistry(value.hooks));

export const readSettings = (settingsPath: string): ClaudeSettings => {
  const content = readTextFile(settingsPath);
  if (content === undefined) return {};
  const parsed = parseJson(content);
  if (!isClaudeSettings(parsed)) {
    throw new Error(`${settingsPath} is not a valid Claude Code settings file`);
  }
  return parsed;
};

export const isResurrectEntry = (entry: HookEntry): boolean =>
  (entry.hooks ?? []).some((hook) => hook.command?.includes(HOOK_FILE_NAME) ?? false);

export const buildCommand = (nodePath: string, hookPath: string): string =>
  `"${nodePath}" "${hookPath}"`;

const resurrectEntry = (command: string): HookEntry => ({
  hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_SECONDS }],
});

const withoutResurrectEntries = (entries: readonly HookEntry[] = []): readonly HookEntry[] =>
  entries.filter((entry) => !isResurrectEntry(entry));

export const applyInstall = (settings: ClaudeSettings, command: string): ClaudeSettings => ({
  ...settings,
  hooks: {
    ...settings.hooks,
    ...Object.fromEntries(
      HOOK_EVENTS.map((eventName) => [
        eventName,
        [...withoutResurrectEntries(settings.hooks?.[eventName]), resurrectEntry(command)],
      ]),
    ),
  },
});

const withoutHooks = (settings: ClaudeSettings): ClaudeSettings =>
  Object.fromEntries(Object.entries(settings).filter(([key]) => key !== 'hooks'));

export const applyUninstall = (settings: ClaudeSettings): ClaudeSettings => {
  if (settings.hooks === undefined) return settings;
  const remainingEntries = (eventName: string, entries: readonly HookEntry[] = []) =>
    isHookEventName(eventName) ? withoutResurrectEntries(entries) : entries;
  const remaining: HookRegistry = Object.fromEntries(
    Object.entries(settings.hooks)
      .map(([eventName, entries]) => [eventName, remainingEntries(eventName, entries)] as const)
      .filter(([eventName, entries]) => !(isHookEventName(eventName) && entries.length === 0)),
  );
  return Object.keys(remaining).length > 0
    ? { ...settings, hooks: remaining }
    : withoutHooks(settings);
};

export const backupExistingFile = (filePath: string): string | undefined => {
  if (!fs.existsSync(filePath)) return undefined;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.bak-${stamp}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
};

// Returns the backup path when a previous settings file existed.
export const writeSettings = (
  settingsPath: string,
  settings: ClaudeSettings,
): string | undefined => {
  const backupPath = backupExistingFile(settingsPath);
  writeFileAtomically(settingsPath, `${JSON.stringify(settings, null, SETTINGS_JSON_INDENT)}\n`);
  return backupPath;
};
