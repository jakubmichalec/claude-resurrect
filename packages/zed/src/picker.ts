// A numbered menu on the controlling terminal for choosing one of several
// pending sessions. Pure formatting and parsing live here; the CLI wires in
// the terminal.

import { displayName } from '@claude-resurrect/core';
import type { RestoreCandidate } from '@claude-resurrect/core';

const LABEL_MAX_LENGTH = 44;

export const candidateLabel = (candidate: RestoreCandidate): string => {
  const name = displayName(candidate);
  return name.length <= LABEL_MAX_LENGTH ? name : `${name.slice(0, LABEL_MAX_LENGTH - 1)}\u2026`;
};

export const menuText = (candidates: readonly RestoreCandidate[], cwd: string): string => {
  const rows = candidates.map((candidate, index) => {
    const where = candidate.cwd === cwd ? '' : `  ${candidate.cwd}`;
    const when = new Date(candidate.endedAt).toLocaleTimeString();
    const prompt = candidate.lastPrompt === undefined ? '' : `\n        ${candidate.lastPrompt}`;
    return `  ${String(index + 1).padStart(2)}  ${candidateLabel(candidate).padEnd(LABEL_MAX_LENGTH)} ${when}${where}${prompt}`;
  });
  return ['Claude Resurrect: interrupted sessions for this folder', ...rows, ''].join('\n');
};

export const MENU_PROMPT = 'Resume which one? [number, Enter = 1, q = none] ';

// Returns the chosen index, or undefined for "none".
export const parseChoice = (reply: string, count: number): number | undefined => {
  const trimmed = reply.trim().toLowerCase();
  if (trimmed === '') return count > 0 ? 0 : undefined;
  if (trimmed === 'q' || trimmed === 'n' || trimmed === 'no') return undefined;
  const number = Number(trimmed);
  return Number.isInteger(number) && number >= 1 && number <= count ? number - 1 : undefined;
};
