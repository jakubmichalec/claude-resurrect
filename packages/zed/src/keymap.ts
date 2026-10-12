// Edits Zed's keymap.json as text. The file allows comments and trailing
// commas, which a JSON round trip would destroy, so the binding is inserted
// into the existing "Workspace" context block, or a new block is added.

import { TASK_LABEL } from './zed-task';

export const DEFAULT_KEY = 'cmd-shift-r';

const WORKSPACE_BINDINGS_PATTERN = /("context"\s*:\s*"Workspace"[\s\S]*?"bindings"\s*:\s*\{)/;

export const bindingLine = (key: string): string =>
  `"${key}": ["task::Spawn", { "task_name": "${TASK_LABEL}" }]`;

export const hasKeybinding = (content: string): boolean => content.includes(TASK_LABEL);

const emptyKeymap = (key: string): string =>
  `[\n  {\n    "context": "Workspace",\n    "bindings": {\n      ${bindingLine(key)},\n    },\n  },\n]\n`;

export const withKeybinding = (content: string, key: string): string => {
  if (hasKeybinding(content)) return content;
  if (content.trim() === '') return emptyKeymap(key);
  if (WORKSPACE_BINDINGS_PATTERN.test(content)) {
    return content.replace(WORKSPACE_BINDINGS_PATTERN, `$1\n      ${bindingLine(key)},`);
  }
  const arrayStart = content.indexOf('[');
  if (arrayStart === -1) throw new Error('keymap.json does not contain a JSON array');
  const block = `\n  {\n    "context": "Workspace",\n    "bindings": {\n      ${bindingLine(key)},\n    },\n  },`;
  return `${content.slice(0, arrayStart + 1)}${block}${content.slice(arrayStart + 1)}`;
};

// Removes the binding line wherever it sits; an emptied block is left in
// place rather than guessed at, since it may have been the user's own.
export const withoutKeybinding = (content: string): string =>
  content
    .split('\n')
    .filter((line) => !line.includes(TASK_LABEL))
    .join('\n');
