// Sessions the user said no to. Without this, every new terminal tab in the
// same folder would ask about the same interrupted session again.

import * as path from 'node:path';
import {
  isRecord,
  parseJson,
  readTextFile,
  stateDirectory,
  writeFileAtomically,
} from '@claude-resurrect/core';

const DECLINED_FILE_NAME = 'zed-declined.json';

const declinedPath = (directory: string): string => path.join(directory, DECLINED_FILE_NAME);

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

export const readDeclined = (directory: string = stateDirectory()): ReadonlySet<string> => {
  const parsed = parseJson(readTextFile(declinedPath(directory)) ?? '');
  return new Set(isRecord(parsed) && isStringArray(parsed.sessionIds) ? parsed.sessionIds : []);
};

// Keeps only ids that still matter so the file cannot grow forever.
export const writeDeclined = (
  sessionIds: ReadonlySet<string>,
  stillRelevant: (sessionId: string) => boolean,
  directory: string = stateDirectory(),
): void => {
  const kept = [...sessionIds].filter(stillRelevant).sort();
  writeFileAtomically(
    declinedPath(directory),
    `${JSON.stringify({ sessionIds: kept }, null, 2)}\n`,
  );
};
