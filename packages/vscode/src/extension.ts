import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  DEFAULT_COMPACTION_SETTINGS,
  HOOK_FILE_NAME,
  applyInstall,
  buildCommand,
  claimSession,
  claudeConfigDirectory,
  compactLogIfQuiet,
  displayName,
  errorMessage,
  findNodeBinary,
  inWorkingDirectory,
  isResurrectEntry,
  isShellIdle,
  loadSessions,
  planRestore,
  pruneClaims,
  readSettings as readClaudeSettings,
  recordLostSessions,
  resumeCommand,
  runningSessionIds,
  summarizeTranscript,
  toCompactionPolicy,
  writeSettings as writeClaudeSettings,
} from '@claude-resurrect/core';
import type { CompactionSettings, RestoreCandidate } from '@claude-resurrect/core';
import { pickTerminalToReuse, terminalNameFor } from './terminal-match';
import type { TerminalFacts } from './terminal-match';

const CONFIGURATION_SECTION = 'claudeResurrect';
const DECLINED_SESSIONS_KEY = 'declinedSessionIds';
const HOOKS_PROMPT_SHOWN_KEY = 'hooksPromptShown';
const MILLISECONDS_PER_SECOND = 1000;
// Restored terminal tabs reappear asynchronously after startup. The restore
// waits until their number has been stable for a moment, or gives up.
const TERMINAL_SETTLE_POLL_MS = 250;
const TERMINAL_SETTLE_QUIET_MS = 1000;
const TERMINAL_SETTLE_MAX_MS = 6000;

const output = vscode.window.createOutputChannel('Claude Resurrect');
const log = (message: string): void => output.appendLine(`${new Date().toISOString()} ${message}`);

type RestoreOnStartup = 'ask' | 'always' | 'never';

interface ExtensionSettings {
  readonly restoreOnStartup: RestoreOnStartup;
  readonly claudeCommand: string;
  readonly extraArguments: readonly string[];
  readonly shutdownWindowMs: number;
  readonly terminalLocation: vscode.TerminalLocation;
  readonly reuseRestoredTerminals: boolean;
  readonly compaction: CompactionSettings;
}

interface RestoreRequest {
  readonly interactive: boolean;
  readonly editorStartedAt: number;
  readonly reportWhenEmpty: boolean;
  readonly waitForTerminals: boolean;
}

const readExtensionSettings = (): ExtensionSettings => {
  const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
  return {
    restoreOnStartup: configuration.get<RestoreOnStartup>('restoreOnStartup', 'ask'),
    claudeCommand: configuration.get<string>('claudeCommand', 'claude'),
    extraArguments: configuration.get<readonly string[]>('extraArguments', []),
    shutdownWindowMs:
      configuration.get<number>('shutdownWindowSeconds', 120) * MILLISECONDS_PER_SECOND,
    terminalLocation:
      configuration.get<string>('terminalLocation', 'editor') === 'panel'
        ? vscode.TerminalLocation.Panel
        : vscode.TerminalLocation.Editor,
    reuseRestoredTerminals: configuration.get<boolean>('reuseRestoredTerminals', true),
    compaction: {
      enabled: configuration.get<boolean>(
        'compaction.enabled',
        DEFAULT_COMPACTION_SETTINGS.enabled,
      ),
      thresholdKb: configuration.get<number>(
        'compaction.thresholdKb',
        DEFAULT_COMPACTION_SETTINGS.thresholdKb,
      ),
      quietSeconds: configuration.get<number>(
        'compaction.quietSeconds',
        DEFAULT_COMPACTION_SETTINGS.quietSeconds,
      ),
      keepInterruptedDays: configuration.get<number>(
        'compaction.keepInterruptedDays',
        DEFAULT_COMPACTION_SETTINGS.keepInterruptedDays,
      ),
    },
  };
};

const workspaceFolderPaths = (): readonly string[] =>
  (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);

const claudeSettingsPath = (): string => path.join(claudeConfigDirectory(), 'settings.json');

const terminalName = (candidate: RestoreCandidate): string => terminalNameFor(candidate);

const describeTerminals = (): string =>
  vscode.window.terminals.map((t) => `"${t.name}"${t.exitStatus ? ' (exited)' : ''}`).join(', ') ||
  'none';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitForTerminalsToSettle = async (): Promise<void> => {
  const startedAt = Date.now();
  let lastCount = vscode.window.terminals.length;
  let stableSince = startedAt;
  while (Date.now() - startedAt < TERMINAL_SETTLE_MAX_MS) {
    await sleep(TERMINAL_SETTLE_POLL_MS);
    const count = vscode.window.terminals.length;
    if (count !== lastCount) {
      lastCount = count;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= TERMINAL_SETTLE_QUIET_MS) {
      return;
    }
  }
};

const describeLocation = (cwd: string, folders: readonly string[]): string => {
  const folder = folders.find((f) => cwd === f || cwd.startsWith(`${f}${path.sep}`));
  const relative = folder === undefined ? cwd : path.relative(folder, cwd);
  return relative === '' ? path.basename(cwd) : relative;
};

interface KnownTerminal extends TerminalFacts {
  readonly terminal: vscode.Terminal;
}

// After a restart the editor brings back the old terminal tabs as fresh
// shells, and Cursor drops the names they had. What can still be known about
// a tab is its current folder (through shell integration) and whether its
// shell runs anything, read from the process tree.
const describeTerminal = async (terminal: vscode.Terminal): Promise<KnownTerminal> => {
  const pid = await terminal.processId;
  return {
    terminal,
    name: terminal.name,
    cwd: terminal.shellIntegration?.cwd?.fsPath,
    idle: terminal.exitStatus === undefined && pid !== undefined && isShellIdle(pid),
  };
};

const describeKnownTerminals = (terminals: readonly KnownTerminal[]): string =>
  terminals.map((t) => `"${t.name}" cwd=${t.cwd ?? '?'} ${t.idle ? 'idle' : 'busy'}`).join('; ') ||
  'none';

const openSessionTerminal = (
  candidate: RestoreCandidate,
  settings: ExtensionSettings,
  available: readonly KnownTerminal[],
): vscode.Terminal => {
  const command = resumeCommand(settings, candidate.sessionId);
  const reused = settings.reuseRestoredTerminals
    ? pickTerminalToReuse(available, candidate)
    : undefined;
  if (reused !== undefined) {
    log(`reusing tab "${reused.name}" (cwd ${reused.cwd ?? '?'}) for ${terminalName(candidate)}`);
    reused.terminal.sendText(inWorkingDirectory(command, candidate.cwd), true);
    reused.terminal.show(true);
    return reused.terminal;
  }
  log(`opening a new tab for ${terminalName(candidate)}`);
  const terminal = vscode.window.createTerminal({
    name: terminalName(candidate),
    cwd: candidate.cwd,
    location: settings.terminalLocation,
  });
  terminal.sendText(command, true);
  terminal.show(true);
  return terminal;
};

const pickSessions = async (
  candidates: readonly RestoreCandidate[],
  folders: readonly string[],
): Promise<readonly RestoreCandidate[] | undefined> => {
  const items = candidates.map((candidate) => ({
    label: displayName(candidate),
    description: describeLocation(candidate.cwd, folders),
    detail: [
      `interrupted ${new Date(candidate.endedAt).toLocaleString()}`,
      ...(candidate.lastPrompt === undefined ? [] : [`last prompt: ${candidate.lastPrompt}`]),
    ].join('  ·  '),
    picked: true,
    candidate,
  }));
  const chosen = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: 'Claude Resurrect',
    placeHolder:
      'Interrupted Claude Code sessions for this window. Untick the ones to leave closed.',
  });
  return chosen?.map((item) => item.candidate);
};

const restoreSessions = async (
  context: vscode.ExtensionContext,
  request: RestoreRequest,
): Promise<void> => {
  const settings = readExtensionSettings();
  const folders = workspaceFolderPaths();
  if (folders.length === 0) return;
  if (request.waitForTerminals) await waitForTerminalsToSettle();
  log(`restore requested for ${folders.join(', ')}; tabs: ${describeTerminals()}`);

  const sessions = loadSessions();
  const previouslyDeclined = new Set(
    context.globalState
      .get<readonly string[]>(DECLINED_SESSIONS_KEY, [])
      .filter((id) => sessions[id]?.status === 'interrupted'),
  );
  const candidates = planRestore({
    sessions,
    workspaceFolders: folders,
    runningSessionIds: runningSessionIds(),
    ignoredSessionIds: request.interactive ? new Set() : previouslyDeclined,
    editorStartedAt: request.editorStartedAt,
    // The window only guards unattended restores; a reviewed list shows everything.
    ...(request.interactive ? {} : { shutdownWindowMs: settings.shutdownWindowMs }),
    transcriptExists: fs.existsSync,
    summarizeTranscript,
  });
  log(`candidates: ${candidates.map(terminalName).join(', ') || 'none'}`);
  if (candidates.length === 0) {
    if (request.reportWhenEmpty) {
      void vscode.window.showInformationMessage(
        'Claude Resurrect: no interrupted Claude Code sessions for this window.',
      );
    }
    return;
  }

  const chosen = request.interactive ? await pickSessions(candidates, folders) : candidates;
  if (chosen === undefined) return;

  const declinedNow = candidates.filter((c) => !chosen.includes(c)).map((c) => c.sessionId);
  await context.globalState.update(DECLINED_SESSIONS_KEY, [...previouslyDeclined, ...declinedNow]);
  const claimed = chosen.filter((candidate) =>
    claimSession(candidate.sessionId, candidate.endedAt),
  );
  const known = await Promise.all(vscode.window.terminals.map(describeTerminal));
  log(`tabs before restore: ${describeKnownTerminals(known)}`);
  claimed.reduce<readonly KnownTerminal[]>((available, candidate) => {
    const used = openSessionTerminal(candidate, settings, available);
    return available.filter((entry) => entry.terminal !== used);
  }, known);
  const skipped = chosen.length - claimed.length;
  if (skipped > 0) {
    void vscode.window.showInformationMessage(
      `Claude Resurrect: ${skipped} session(s) skipped because another window is already restoring them.`,
    );
  }
};

const hooksAreInstalled = (): boolean =>
  Object.values(readClaudeSettings(claudeSettingsPath()).hooks ?? {}).some((entries) =>
    entries.some(isResurrectEntry),
  );

const installHooks = async (context: vscode.ExtensionContext): Promise<void> => {
  const settingsPath = claudeSettingsPath();
  const hookPath = path.join(context.extensionPath, 'dist', HOOK_FILE_NAME);
  const command = buildCommand(findNodeBinary(), hookPath);
  const answer = await vscode.window.showInformationMessage(
    `Add SessionStart and SessionEnd hooks to ${settingsPath}?`,
    {
      modal: true,
      detail: `Hook command:\n${command}\n\nA backup of the file is kept next to it.`,
    },
    'Install',
  );
  if (answer !== 'Install') return;
  const backupPath = writeClaudeSettings(
    settingsPath,
    applyInstall(readClaudeSettings(settingsPath), command),
  );
  void vscode.window.showInformationMessage(
    `Claude Resurrect hooks installed. Sessions started from now on are tracked.${
      backupPath === undefined ? '' : ` Backup: ${backupPath}`
    }`,
  );
};

const offerHookInstallation = async (context: vscode.ExtensionContext): Promise<void> => {
  if (context.globalState.get<boolean>(HOOKS_PROMPT_SHOWN_KEY, false) || hooksAreInstalled()) {
    return;
  }
  await context.globalState.update(HOOKS_PROMPT_SHOWN_KEY, true);
  const answer = await vscode.window.showInformationMessage(
    'Claude Resurrect needs two Claude Code hooks to know which sessions were open.',
    'Install hooks',
  );
  if (answer === 'Install hooks') await installHooks(context);
};

const reportFailure = (action: string) => (error: unknown) =>
  vscode.window.showErrorMessage(`Claude Resurrect could not ${action}: ${errorMessage(error)}`);

export const activate = (context: vscode.ExtensionContext): void => {
  const editorStartedAt = Date.now() - process.uptime() * MILLISECONDS_PER_SECOND;
  // Before anything can start a new Claude session (which purges dead
  // registry entries), note the sessions that died without a SessionEnd.
  // A failure here must not take the whole extension down with it.
  try {
    recordLostSessions({ endedAt: editorStartedAt - 1 });
  } catch (error) {
    void reportFailure('record lost sessions')(error);
  }

  log(`activated; editor started ${new Date(editorStartedAt).toISOString()}`);
  context.subscriptions.push(
    output,
    vscode.commands.registerCommand('claudeResurrect.restore', () =>
      restoreSessions(context, {
        interactive: true,
        editorStartedAt: Date.now(),
        reportWhenEmpty: true,
        waitForTerminals: false,
      }).catch(reportFailure('restore sessions')),
    ),
    vscode.commands.registerCommand('claudeResurrect.installHooks', () =>
      installHooks(context).catch(reportFailure('install the hooks')),
    ),
  );

  const { restoreOnStartup, compaction } = readExtensionSettings();
  if (restoreOnStartup !== 'never') {
    void restoreSessions(context, {
      interactive: restoreOnStartup === 'ask',
      editorStartedAt,
      reportWhenEmpty: false,
      waitForTerminals: true,
    }).catch(reportFailure('restore sessions'));
  }
  void offerHookInstallation(context).catch(reportFailure('check the hooks'));
  compactLogIfQuiet(toCompactionPolicy(compaction));
  pruneClaims();
};

export const deactivate = (): void => undefined;
