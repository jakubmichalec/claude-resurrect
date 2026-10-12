// ask: the resume command (or the picker) is placed in the input line.
// always: the oldest session from the last shutdown starts on its own.
// hint: nothing starts; a one-line status points at the Zed task, which
//       opens sessions in the editor area.
// never: the snippet does nothing.
export const MODES = ['ask', 'always', 'hint', 'never'] as const;

export type Mode = (typeof MODES)[number];

export const isMode = (value: unknown): value is Mode => MODES.some((mode) => mode === value);
