// Several editor windows may activate at the same time and see the same
// interrupted session, for example when a folder is open twice. A claim file
// created with the exclusive flag makes sure only one of them resumes it.
// A claim covers one interruption: the same session interrupted again later
// gets a new claim, so a restore never blocks the next one.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { attempt } from './io';
import { stateDirectory } from './state';

const CLAIM_TTL_MS = 5 * 60 * 1000;
const CLAIM_RETENTION_MS = 24 * 60 * 60 * 1000;
const CLAIMS_DIRECTORY_NAME = 'claims';

const claimsDirectory = (directory: string): string => path.join(directory, CLAIMS_DIRECTORY_NAME);

const claimPath = (sessionId: string, endedAt: number, directory: string): string =>
  path.join(claimsDirectory(directory), `${sessionId}-${endedAt}.claim`);

const isFresh = (filePath: string, now: number): boolean => {
  const stats = attempt(() => fs.statSync(filePath));
  return stats !== undefined && now - stats.mtimeMs < CLAIM_TTL_MS;
};

export const claimSession = (
  sessionId: string,
  endedAt: number,
  directory: string = stateDirectory(),
  now: number = Date.now(),
): boolean => {
  const filePath = claimPath(sessionId, endedAt, directory);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (isFresh(filePath, now)) return false;
  // A stale claim is taken over; an absent one is created exclusively so two
  // windows racing for it cannot both win.
  const flag = fs.existsSync(filePath) ? 'w' : 'wx';
  return (
    attempt(() => {
      fs.writeFileSync(filePath, String(now), { flag });
      return true;
    }) ?? false
  );
};

// Returns how many old claim files were removed.
export const pruneClaims = (
  directory: string = stateDirectory(),
  now: number = Date.now(),
): number => {
  const folder = claimsDirectory(directory);
  const fileNames = attempt(() => fs.readdirSync(folder)) ?? [];
  const isExpired = (fileName: string): boolean => {
    const stats = attempt(() => fs.statSync(path.join(folder, fileName)));
    return stats !== undefined && now - stats.mtimeMs > CLAIM_RETENTION_MS;
  };
  return fileNames
    .filter((fileName) => fileName.endsWith('.claim') && isExpired(fileName))
    .filter(
      (fileName) =>
        attempt(() => {
          fs.rmSync(path.join(folder, fileName));
          return true;
        }) === true,
    ).length;
};
