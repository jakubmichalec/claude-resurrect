// Asks on the controlling terminal. Stdout is reserved for the command the
// shell will eval, so questions go to /dev/tty.

import * as fs from 'node:fs';
import * as readline from 'node:readline';
import * as tty from 'node:tty';
import { attempt } from '@claude-resurrect/core';

const TTY_PATH = '/dev/tty';

export type Answer = 'yes' | 'no' | 'timeout' | 'no-terminal';

interface TerminalLine {
  readonly ask: (question: string) => Promise<string | undefined>;
  readonly write: (text: string) => void;
  readonly close: () => void;
}

const openTerminalLine = (): TerminalLine | undefined => {
  const fd = attempt(() => fs.openSync(TTY_PATH, 'r+'));
  if (fd === undefined) return undefined;
  const input = new tty.ReadStream(fd);
  const output = new tty.WriteStream(fd);
  const rl = readline.createInterface({ input, output, terminal: true });
  return {
    ask: (question) =>
      new Promise((resolve) => {
        rl.question(question, (reply) => resolve(reply));
      }),
    write: (text) => output.write(text),
    close: () => {
      rl.close();
      input.destroy();
      output.destroy();
    },
  };
};

export const askYesNo = (question: string, timeoutMs: number): Promise<Answer> =>
  new Promise((resolve) => {
    const line = openTerminalLine();
    if (line === undefined) {
      resolve('no-terminal');
      return;
    }
    const finish = (answer: Answer, note?: string): void => {
      clearTimeout(timer);
      line.write(note === undefined ? '\n' : `\n${note}\n`);
      line.close();
      resolve(answer);
    };
    const timer = setTimeout(
      () =>
        finish(
          'timeout',
          'No answer, leaving it for later: run claude-resurrect-zed next, or use the Zed task.',
        ),
      timeoutMs,
    );
    void line.ask(question).then((reply) => {
      finish(/^(y|yes|)$/i.test((reply ?? '').trim()) ? 'yes' : 'no');
    });
  });

// Shows text, then asks one question. Resolves to undefined without a terminal.
export const askOnTerminal = async (
  text: string,
  question: string,
): Promise<string | undefined> => {
  const line = openTerminalLine();
  if (line === undefined) return undefined;
  line.write(text);
  const reply = await line.ask(question);
  line.close();
  return reply;
};
