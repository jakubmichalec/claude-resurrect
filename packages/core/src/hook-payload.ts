import { isOptionalString, isRecord } from './io';

export const HOOK_EVENTS = ['SessionStart', 'SessionEnd'] as const;

export type HookEventName = (typeof HOOK_EVENTS)[number];

interface HookPayloadBase {
  readonly session_id: string;
  readonly cwd?: string;
  readonly transcript_path?: string;
}

export interface SessionStartPayload extends HookPayloadBase {
  readonly hook_event_name: 'SessionStart';
  readonly source?: string;
}

export interface SessionEndPayload extends HookPayloadBase {
  readonly hook_event_name: 'SessionEnd';
  readonly reason?: string;
}

export type HookPayload = SessionStartPayload | SessionEndPayload;

export const isHookEventName = (value: unknown): value is HookEventName =>
  HOOK_EVENTS.some((name) => name === value);

// Validates what Claude Code pipes to the hook on stdin before anything trusts it.
export const isHookPayload = (value: unknown): value is HookPayload =>
  isRecord(value) &&
  typeof value.session_id === 'string' &&
  isHookEventName(value.hook_event_name) &&
  isOptionalString(value.cwd) &&
  isOptionalString(value.transcript_path) &&
  isOptionalString(value.source) &&
  isOptionalString(value.reason);
