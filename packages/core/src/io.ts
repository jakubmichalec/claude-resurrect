import * as fs from 'node:fs';
import * as path from 'node:path';

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string';

export const isDefined = <T>(value: T | undefined): value is T => value !== undefined;

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// Runs an action whose failure is expected and uninteresting, such as reading
// a file that may not exist yet. Failures that matter must not use this.
export const attempt = <T>(action: () => T): T | undefined => {
  try {
    return action();
  } catch {
    return undefined;
  }
};

const isMissingFileError = (error: unknown): boolean => isRecord(error) && error.code === 'ENOENT';

// A missing file is an expected state and yields undefined. Any other failure
// (permissions, I/O) is exceptional and propagates.
export const readTextFile = (filePath: string): string | undefined => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
};

export const parseJson = (text: string): unknown => attempt((): unknown => JSON.parse(text));

// Writes to a sibling temporary file and renames it into place, so a reader
// never observes a partially written file.
export const writeFileAtomically = (filePath: string, content: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, content);
  fs.renameSync(temporaryPath, filePath);
};
