// Claude Code writes two useful records into a session's transcript: an
// AI-generated title for the conversation and the last prompt the user sent.
// Both sit near the end of the file, so only the tail is read.

import * as fs from 'node:fs';
import { attempt, isRecord, parseJson } from './io';

const TAIL_BYTES = 64 * 1024;
const LAST_PROMPT_MAX_LENGTH = 60;

export interface TranscriptSummary {
  readonly title?: string;
  readonly lastPrompt?: string;
}

const readTail = (filePath: string): string | undefined =>
  attempt(() => {
    const fd = fs.openSync(filePath, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const start = Math.max(0, size - TAIL_BYTES);
      const buffer = Buffer.alloc(size - start);
      fs.readSync(fd, buffer, 0, buffer.length, start);
      const text = buffer.toString('utf8');
      // The first line of a tail is usually cut mid-record; drop it.
      return start === 0 ? text : text.slice(text.indexOf('\n') + 1);
    } finally {
      fs.closeSync(fd);
    }
  });

const shorten = (text: string): string => {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length <= LAST_PROMPT_MAX_LENGTH
    ? singleLine
    : `${singleLine.slice(0, LAST_PROMPT_MAX_LENGTH - 1)}…`;
};

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

export const summarizeTranscriptText = (text: string): TranscriptSummary => {
  const records = text.split('\n').map(parseJson).filter(isRecord);
  const last = (type: string, field: string): string | undefined =>
    records
      .filter((record) => record.type === type)
      .map((record) => nonEmpty(record[field]))
      .filter((value): value is string => value !== undefined)
      .at(-1);
  const title = last('ai-title', 'aiTitle');
  const lastPrompt = last('last-prompt', 'lastPrompt');
  return {
    ...(title === undefined ? {} : { title }),
    ...(lastPrompt === undefined ? {} : { lastPrompt: shorten(lastPrompt) }),
  };
};

export const summarizeTranscript = (transcriptPath: string): TranscriptSummary => {
  const tail = readTail(transcriptPath);
  return tail === undefined ? {} : summarizeTranscriptText(tail);
};

// The best human readable name for a session: what the user named it, else
// Claude's own title for the conversation, else the short id.
export const displayName = (session: {
  readonly sessionId: string;
  readonly name?: string;
  readonly title?: string;
}): string => session.name ?? session.title ?? `claude ${session.sessionId.slice(0, 8)}`;
