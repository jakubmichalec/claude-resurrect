import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import {
  HOOK_FILE_NAME,
  applyInstall,
  applyUninstall,
  attempt,
  backupExistingFile,
  buildCommand,
  claimSession,
  claudeConfigDirectory,
  errorMessage,
  findNodeBinary,
  loadSessions,
  parseJson,
  readSettings,
  readTextFile,
  recordLostSessions,
  runningSessionIds,
  summarizeTranscript,
  writeFileAtomically,
  writeSettings,
} from '@claude-resurrect/core';
import type { RestoreCandidate } from '@claude-resurrect/core';
import { spawnSync } from 'node:child_process';
import { readDeclined, writeDeclined } from './declined';
import { MENU_PROMPT, candidateLabel, menuText, parseChoice } from './picker';
import { doctorReport } from './doctor';
import { DEFAULT_KEY, hasKeybinding, withKeybinding, withoutKeybinding } from './keymap';
import { isMode } from './mode';
import type { Mode } from './mode';
import { commandFor, pendingSessions } from './next-session';
import { askOnTerminal, askYesNo } from './prompt';
import { shellSnippet } from './shell-init';
import {
  hasShellInit,
  shellInitLine,
  shellRcPath,
  withShellInit,
  withoutShellInit,
} from './shell-rc';
import {
  TASK_LABEL,
  isTerminalTarget,
  resurrectTask,
  withResurrectTask,
  withoutResurrectTask,
} from './zed-task';
import type { TerminalTarget } from './zed-task';

const DEFAULT_MODE: Mode = 'ask';
const DEFAULT_PROMPT_TIMEOUT_SECONDS = 15;
const DEFAULT_SHUTDOWN_WINDOW_SECONDS = 120;
const MILLISECONDS_PER_SECOND = 1000;

const USAGE = `claude-resurrect-zed <command> [options]

Commands
  setup          Do everything below in one go: hooks, Zed task, shell startup line, keybinding
  teardown       Undo setup
  next           Print the command that resumes the next pending session for the current folder
  pick           Choose one of the pending sessions from a menu and resume it in this terminal
  forget         Stop offering sessions: forget <id>... or forget --all for the current folder
  line           Print what belongs in a restored zsh tab's input line (used by the shell snippet)
  pending        List the sessions that would be offered for the current folder
  doctor         Explain why this terminal would or would not get a session
  summary        One line about the sessions pending for the current folder, or nothing
  shell-init     Print the snippet for your shell startup file: eval "$(claude-resurrect-zed shell-init)"
  install-task   Add the "Claude Resurrect: next session" task to Zed's global tasks.json
  uninstall-task Remove that task again
  install-hooks  Register the Claude Code hooks in ~/.claude/settings.json
  uninstall-hooks

Options
  --mode <ask|always|hint|never>
                              ask: resume command or picker in the input line (default)
                              always: start the oldest session of the last shutdown silently
                              hint: start nothing, show a status pointing at the Zed task
                              never: do nothing
  --key <binding>             key for the Zed task in setup (default: ${DEFAULT_KEY})
  --terminal <center|dock>    where the Zed task opens its tab (default: center, the editor area)
  --rc <path>                 shell startup file for setup (default: from $SHELL)
  --cwd <path>                folder to restore for (default: current directory)
  --claude <command>          command that launches Claude Code (default: claude)
  --timeout <seconds>         how long "ask" waits for an answer (default: ${DEFAULT_PROMPT_TIMEOUT_SECONDS})
  --window <seconds>          in always mode, only sessions interrupted this close to the last one are taken (default: ${DEFAULT_SHUTDOWN_WINDOW_SECONDS})
  --all                       for forget: every pending session of the current folder
  --choose <number>           for pick: take that entry without showing the menu
  --print                     for pick: print the resume command instead of running it
`;

interface Options {
  readonly command: string | undefined;
  readonly mode: Mode;
  readonly modeGiven: boolean;
  readonly cwd: string;
  readonly claudeCommand: string;
  readonly promptTimeoutMs: number;
  readonly key: string;
  readonly rcPath: string;
  readonly terminal: TerminalTarget;
  readonly choose: number | undefined;
  readonly print: boolean;
  readonly shutdownWindowMs: number;
  readonly all: boolean;
  readonly ids: readonly string[];
}

const parseOptions = (argv: readonly string[]): Options => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      mode: { type: 'string' },
      cwd: { type: 'string' },
      claude: { type: 'string' },
      timeout: { type: 'string' },
      key: { type: 'string' },
      rc: { type: 'string' },
      terminal: { type: 'string' },
      choose: { type: 'string' },
      print: { type: 'boolean' },
      window: { type: 'string' },
      all: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.mode !== undefined && !isMode(values.mode)) {
    throw new Error(`--mode must be ask, always, hint or never, got "${values.mode}"`);
  }
  if (values.terminal !== undefined && !isTerminalTarget(values.terminal)) {
    throw new Error(`--terminal must be center or dock, got "${values.terminal}"`);
  }
  return {
    command: values.help ? 'help' : positionals[0],
    mode: values.mode ?? DEFAULT_MODE,
    modeGiven: values.mode !== undefined,
    cwd: path.resolve(values.cwd ?? process.cwd()),
    claudeCommand: values.claude ?? 'claude',
    promptTimeoutMs:
      Number(values.timeout ?? DEFAULT_PROMPT_TIMEOUT_SECONDS) * MILLISECONDS_PER_SECOND,
    key: values.key ?? DEFAULT_KEY,
    rcPath: values.rc ?? shellRcPath(process.env.SHELL, os.homedir()),
    terminal: values.terminal ?? 'center',
    choose: values.choose === undefined ? undefined : Number(values.choose),
    print: values.print ?? false,
    shutdownWindowMs:
      Number(values.window ?? DEFAULT_SHUTDOWN_WINDOW_SECONDS) * MILLISECONDS_PER_SECOND,
    all: values.all ?? false,
    ids: positionals.slice(1),
  };
};

const realPath = (folder: string): string => attempt(() => fs.realpathSync(folder)) ?? folder;

const label = candidateLabel;

// "unattended" limits the list to the latest shutdown; a menu shows everything.
const candidatesFor = (
  options: Options,
  now: number,
  { unattended = false } = {},
): readonly RestoreCandidate[] => {
  // Sessions that died without a hook are noted first, so they are offered too.
  recordLostSessions({ endedAt: now - 1, now });
  return pendingSessions({
    ...(unattended ? { shutdownWindowMs: options.shutdownWindowMs } : {}),
    sessions: loadSessions(),
    cwd: options.cwd,
    runningSessionIds: runningSessionIds(),
    declinedSessionIds: readDeclined(),
    now,
    transcriptExists: fs.existsSync,
    normalizePath: realPath,
    summarizeTranscript,
  });
};

const decline = (sessionId: string): void => {
  const sessions = loadSessions();
  writeDeclined(
    new Set([...readDeclined(), sessionId]),
    (id) => sessions[id]?.status === 'interrupted',
  );
};

const runNext = async (options: Options): Promise<string> => {
  if (options.mode === 'never' || options.mode === 'hint') return '';
  const unattended = options.mode === 'always';
  const candidates = candidatesFor(options, Date.now(), { unattended });
  if (options.mode !== 'ask') return firstClaimable(candidates, options) ?? '';
  for (const candidate of candidates) {
    const question = `Claude Resurrect: resume "${label(candidate)}" in this terminal? [Y/n] `;
    const answer = await askYesNo(question, options.promptTimeoutMs);
    // Only an explicit no is remembered. A question nobody answered, or
    // one that could not be shown, leaves the session pending.
    if (answer === 'no') decline(candidate.sessionId);
    if (answer !== 'yes') return '';
    const command = claimAndCommand(candidate, options);
    if (command !== undefined) return command;
  }
  return '';
};

const launch = (options: Options) => ({ claudeCommand: options.claudeCommand, extraArguments: [] });

const claimAndCommand = (candidate: RestoreCandidate, options: Options): string | undefined =>
  claimSession(candidate.sessionId, candidate.endedAt)
    ? commandFor(candidate, realPath(options.cwd), launch(options))
    : undefined;

// Runs the resume command in this terminal and reports Claude's exit code.
const runInThisTerminal = (command: string): never => {
  const result = spawnSync(process.env.SHELL ?? 'sh', ['-c', command], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
};

const chooseCandidate = async (
  candidates: readonly RestoreCandidate[],
  options: Options,
): Promise<RestoreCandidate | undefined> => {
  if (options.choose !== undefined) return candidates[options.choose - 1];
  if (candidates.length === 1) return candidates[0];
  const reply = await askOnTerminal(menuText(candidates, options.cwd), MENU_PROMPT);
  if (reply === undefined)
    throw new Error('pick needs a terminal; use --choose <number> otherwise');
  const index = parseChoice(reply, candidates.length);
  return index === undefined ? undefined : candidates[index];
};

const runPick = async (options: Options): Promise<string> => {
  const candidates = candidatesFor(options, Date.now());
  if (candidates.length === 0) return `No pending Claude Code sessions for ${options.cwd}`;
  const chosen = await chooseCandidate(candidates, options);
  if (chosen === undefined) return '';
  const command = claimAndCommand(chosen, options);
  if (command === undefined)
    return `"${label(chosen)}" is already being resumed in another terminal.`;
  if (options.print) return command;
  return runInThisTerminal(command);
};

// Claims lazily: a claim is a side effect, so stop at the first that succeeds.
const firstClaimable = (
  candidates: readonly RestoreCandidate[],
  options: Options,
): string | undefined => {
  for (const candidate of candidates) {
    const command = claimAndCommand(candidate, options);
    if (command !== undefined) return command;
  }
  return undefined;
};

// What a restored zsh tab should get in its input line. One pending session
// becomes its resume command (claimed now); several become the picker so the
// user chooses; "always" takes the oldest the tab can still claim, so tabs
// starting together each get a different session.
const runLine = (options: Options): string => {
  if (options.mode === 'never' || options.mode === 'hint') return '';
  const unattended = options.mode === 'always';
  const candidates = candidatesFor(options, Date.now(), { unattended });
  if (candidates.length === 0) return '';
  if (!unattended && candidates.length > 1) return 'claude-resurrect-zed pick';
  return firstClaimable(candidates, options) ?? '';
};

const runForget = (options: Options): string => {
  const pending = candidatesFor(options, Date.now());
  const chosen = options.all
    ? pending
    : pending.filter((c) => options.ids.some((id) => c.sessionId.startsWith(id)));
  if (chosen.length === 0) return 'Nothing matched; see "pending" for ids, or use --all.';
  const sessions = loadSessions();
  writeDeclined(
    new Set([...readDeclined(), ...chosen.map((c) => c.sessionId)]),
    (id) => sessions[id]?.status === 'interrupted',
  );
  return `Forgot ${chosen.length} session(s):\n${chosen.map((c) => `  ${label(c)}  ${c.sessionId}`).join('\n')}`;
};

const runSummary = (options: Options): string => {
  const candidates = candidatesFor(options, Date.now());
  if (candidates.length === 0) return '';
  const names = candidates.map(label).join(', ');
  const count = candidates.length === 1 ? '1 session' : `${candidates.length} sessions`;
  return `Claude Resurrect: ${count} pending here (${names}). Press ${options.key} to open one in the editor area.`;
};

const runPending = (options: Options): string => {
  const candidates = candidatesFor(options, Date.now());
  if (candidates.length === 0) return `No pending Claude Code sessions for ${options.cwd}`;
  return candidates
    .map(
      (c) =>
        `${label(c)}  ${c.sessionId}  interrupted ${new Date(c.endedAt).toLocaleString()}\n  ${c.cwd}`,
    )
    .join('\n');
};

const zedTasksPath = (): string =>
  path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'zed', 'tasks.json');

const readZedTasks = (tasksPath: string): readonly unknown[] => {
  const content = readTextFile(tasksPath);
  if (content === undefined || content.trim() === '') return [];
  const parsed = parseJson(content);
  if (!Array.isArray(parsed)) {
    throw new Error(
      `${tasksPath} is not a plain JSON array (comments are not supported here). Add this task by hand:\n${JSON.stringify(resurrectTask(DEFAULT_MODE), null, 2)}`,
    );
  }
  return parsed;
};

const writeZedTasks = (tasksPath: string, tasks: readonly unknown[]): string | undefined => {
  const backupPath = backupExistingFile(tasksPath);
  writeFileAtomically(tasksPath, `${JSON.stringify(tasks, null, 2)}\n`);
  return backupPath;
};

const withBackupNote = (message: string, backupPath: string | undefined): string =>
  backupPath === undefined ? message : `${message}\nBackup of the previous file: ${backupPath}`;

// The task opens the menu by default; "--mode always" makes it take the
// oldest session without asking.
const runInstallTask = (options: Options, { withKeymapHint = true } = {}): string => {
  const tasksPath = zedTasksPath();
  const tasks = withResurrectTask(
    readZedTasks(tasksPath),
    resurrectTask(options.mode, options.terminal),
  );
  const backupPath = writeZedTasks(tasksPath, tasks);
  const hint = withKeymapHint
    ? `\nBind it in Zed's keymap with {"context": "Workspace", "bindings": {"${DEFAULT_KEY}": ["task::Spawn", {"task_name": "${TASK_LABEL}"}]}} or run setup to have it done.`
    : '';
  return withBackupNote(`Added the task "${TASK_LABEL}" to ${tasksPath}.${hint}`, backupPath);
};

const runUninstallTask = (): string => {
  const tasksPath = zedTasksPath();
  const backupPath = writeZedTasks(tasksPath, withoutResurrectTask(readZedTasks(tasksPath)));
  return withBackupNote(`Removed the task from ${tasksPath}.`, backupPath);
};

const claudeSettingsPath = (): string => path.join(claudeConfigDirectory(), 'settings.json');

const runInstallHooks = (): string => {
  const settingsPath = claudeSettingsPath();
  const command = buildCommand(findNodeBinary(), path.resolve(__dirname, HOOK_FILE_NAME));
  const backupPath = writeSettings(settingsPath, applyInstall(readSettings(settingsPath), command));
  return withBackupNote(
    `Installed the Claude Code hooks in ${settingsPath}.\nHook command: ${command}`,
    backupPath,
  );
};

const runUninstallHooks = (): string => {
  const settingsPath = claudeSettingsPath();
  const backupPath = writeSettings(settingsPath, applyUninstall(readSettings(settingsPath)));
  return withBackupNote(`Removed the Claude Code hooks from ${settingsPath}.`, backupPath);
};

const zedKeymapPath = (): string => path.join(path.dirname(zedTasksPath()), 'keymap.json');

const editTextFile = (
  filePath: string,
  alreadyDone: (content: string) => boolean,
  edit: (content: string) => string,
  doneMessage: string,
): string => {
  const content = readTextFile(filePath) ?? '';
  if (alreadyDone(content)) return `${filePath}: already set up`;
  const backupPath = backupExistingFile(filePath);
  writeFileAtomically(filePath, edit(content));
  return withBackupNote(`${filePath}: ${doneMessage}`, backupPath);
};

const shellStartupLine = (options: Options): string =>
  shellInitLine(
    'claude-resurrect-zed',
    options.modeGiven ? options.mode : undefined,
    options.mode === 'hint' && options.key !== DEFAULT_KEY ? options.key : undefined,
  );

const runSetup = (options: Options): string =>
  [
    runInstallHooks(),
    runInstallTask(options, { withKeymapHint: false }),
    editTextFile(
      options.rcPath,
      // Done only when the block carries this exact line; a mode change rewrites it.
      (content) => hasShellInit(content) && content.includes(shellStartupLine(options)),
      (content) => withShellInit(content, shellStartupLine(options)),
      'added the shell startup line (takes effect in new shells)',
    ),
    editTextFile(
      zedKeymapPath(),
      hasKeybinding,
      (content) => withKeybinding(content, options.key),
      `bound ${options.key} to the task`,
    ),
  ].join('\n\n');

const runTeardown = (options: Options): string =>
  [
    runUninstallHooks(),
    runUninstallTask(),
    editTextFile(
      options.rcPath,
      (c) => !hasShellInit(c),
      withoutShellInit,
      'removed the shell startup line',
    ),
    editTextFile(
      zedKeymapPath(),
      (c) => !hasKeybinding(c),
      withoutKeybinding,
      'removed the keybinding',
    ),
  ].join('\n\n');

const run = async (argv: readonly string[]): Promise<string> => {
  const options = parseOptions(argv);
  switch (options.command) {
    case 'setup':
      return runSetup(options);
    case 'teardown':
      return runTeardown(options);
    case 'next':
      return runNext(options);
    case 'pick':
      return runPick(options);
    case 'forget':
      return runForget(options);
    case 'line':
      return runLine(options);
    case 'pending':
      return runPending(options);
    case 'doctor':
      return doctorReport({
        cwd: options.cwd,
        environment: process.env,
        stdinIsTerminal: process.stdin.isTTY === true,
        pending: candidatesFor(options, Date.now()),
        declined: readDeclined(),
      });
    case 'summary':
      return runSummary(options);
    case 'shell-init':
      return shellSnippet(options.mode, 'claude-resurrect-zed', options.key);
    case 'install-task':
      return runInstallTask(options);
    case 'uninstall-task':
      return runUninstallTask();
    case 'install-hooks':
      return runInstallHooks();
    case 'uninstall-hooks':
      return runUninstallHooks();
    case 'help':
    case undefined:
      return USAGE;
    default:
      throw new Error(`Unknown command "${options.command}"\n\n${USAGE}`);
  }
};

run(process.argv.slice(2))
  .then((output) => {
    if (output !== '') process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
  })
  .catch((error: unknown) => {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
