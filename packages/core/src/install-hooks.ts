import * as path from 'node:path';
import { parseArgs } from 'node:util';
import {
  HOOK_FILE_NAME,
  applyInstall,
  applyUninstall,
  buildCommand,
  readSettings,
  writeSettings,
} from './installer';
import { errorMessage, isDefined } from './io';
import { claudeConfigDirectory } from './state';

interface InstallerOptions {
  readonly settingsPath: string;
  readonly hookPath: string;
  readonly nodePath: string;
  readonly uninstall: boolean;
  readonly dryRun: boolean;
}

const parseOptions = (argv: readonly string[]): InstallerOptions => {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      settings: { type: 'string' },
      hook: { type: 'string' },
      node: { type: 'string' },
      uninstall: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
    },
  });
  return {
    settingsPath: values.settings ?? path.join(claudeConfigDirectory(), 'settings.json'),
    // The bundled hook sits next to this script in dist/.
    hookPath: values.hook ?? path.resolve(__dirname, HOOK_FILE_NAME),
    nodePath: values.node ?? process.execPath,
    uninstall: values.uninstall ?? false,
    dryRun: values['dry-run'] ?? false,
  };
};

const summary = (
  options: InstallerOptions,
  command: string,
  backupPath: string | undefined,
): string =>
  [
    `${options.uninstall ? 'Removed' : 'Installed'} claude-resurrect hooks in ${options.settingsPath}`,
    options.uninstall ? undefined : `Hook command: ${command}`,
    backupPath === undefined ? undefined : `Backup of previous settings: ${backupPath}`,
  ]
    .filter(isDefined)
    .join('\n');

const run = (argv: readonly string[]): string => {
  const options = parseOptions(argv);
  const command = buildCommand(options.nodePath, options.hookPath);
  const settings = readSettings(options.settingsPath);
  const updated = options.uninstall ? applyUninstall(settings) : applyInstall(settings, command);
  if (options.dryRun) return JSON.stringify(updated, null, 2);
  return summary(options, command, writeSettings(options.settingsPath, updated));
};

try {
  process.stdout.write(`${run(process.argv.slice(2))}\n`);
} catch (error) {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
}
