# Claude Resurrect

[![CI](https://github.com/jakubmichalec/claude-resurrect/actions/workflows/ci.yml/badge.svg)](https://github.com/jakubmichalec/claude-resurrect/actions/workflows/ci.yml)

Bring back the [Claude Code](https://code.claude.com) CLI sessions that were open in your editor terminals before a restart.

If you run many `claude` sessions in Cursor or VS Code terminals, a reboot or editor quit kills all of them, and getting back to work means remembering which sessions were open where and running `claude -r <id>` for each one. Claude Resurrect records which sessions were running, tells apart "the editor quit" from "I closed this one", and reopens the interrupted ones in editor-area terminals of the right window.

This is an independent community project. It is not affiliated with or endorsed by Anthropic.

## How it works

1. Two Claude Code hooks, `SessionStart` and `SessionEnd`, append one line each to a local event log at `~/.claude/resurrect/events.jsonl`.
2. `SessionEnd` carries a reason. `/exit`, Ctrl-C and Ctrl-D produce `prompt_input_exit`, so the session is dropped from the log. A SIGHUP from the editor quitting or the machine restarting produces `other`, so the session is kept and marked interrupted.
3. When a window opens, the extension folds the log, picks interrupted sessions whose working directory belongs to that window, and resumes each one with `claude -r <id>`, inside an idle terminal tab the editor restored when one exists, otherwise in a new editor-area terminal.

The `SessionEnd` hook is not the only source of truth. If a session is killed so abruptly that the hook never runs, two other signals remain: Claude Code's own session registry still lists it with a dead process id, and the extension's log still shows it as active while no process with that id exists. On startup the extension records both kinds as lost, before Claude Code purges dead registry entries, so they are offered like any interrupted session. Sessions started by other front ends, such as an editor panel, are left to that front end.

In `always` mode only sessions killed by the same shutdown are restored. The last interruption before the editor started marks that shutdown, and sessions that ended within `shutdownWindowSeconds` before it belong to it. In `ask` mode the list shows every interrupted session for the window, oldest first, so nothing is hidden and you untick what you do not want. A session you closed by hand, whether with `/exit` or by closing its terminal tab, stays closed either way.

The log is append-only on purpose. When the editor quits, every terminal receives SIGHUP at once and every hook fires at the same moment. Appends of small lines do not race, while a shared state file would.

## Installing

Requires Node 18 or newer and Claude Code with hooks support.

### Cursor and VS Code

Search for "Claude Resurrect" in the Extensions view, or install from [Open VSX](https://open-vsx.org/extension/jakubmichalec/claude-resurrect) (Cursor, Windsurf and other forks) or the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=jakubmichalec.claude-resurrect) (VS Code).

On first activation the extension offers to install the two Claude Code hooks. It shows the exact command it will add to `~/.claude/settings.json`, keeps a timestamped backup of the file, and leaves every other hook untouched. The same is available later as the command "Claude Resurrect: Install Claude Code Hooks".

### Zed

Zed extensions cannot open terminals, so Zed uses a small CLI instead. Two commands do everything:

```sh
npm install -g claude-resurrect-zed
claude-resurrect-zed setup
```

`setup` registers the Claude Code hooks, adds the task "Claude Resurrect: next session" to Zed, puts `eval "$(claude-resurrect-zed shell-init)"` in your shell startup file, and binds `cmd-shift-r` to the task in Zed's keymap. Every step keeps a backup and can be undone with `teardown`. From then on, tabs that Zed restores after a restart ask whether to resume their session, and the key opens a new tab with the next pending one.

Details, options and how sessions are chosen: [packages/zed/README.md](packages/zed/README.md).

## Using it

- On startup, each window lists its interrupted sessions with every entry ticked. Press Enter to restore them, untick the ones to leave closed, or press Escape to skip. Declined sessions are not offered again automatically.
- "Claude Resurrect: Restore Sessions" from the command palette shows the list at any time.
- Cursor and VS Code bring back the previous terminal tabs after a restart as fresh shells, and Cursor drops the names they had. Rather than leave those dead tabs next to new ones, the extension resumes each session inside an idle restored shell, preferring one whose folder matches the session. A shell is idle when its process has no children, so a tab running anything is never touched. Turn this off with `claudeResurrect.reuseRestoredTerminals` if you would rather keep restored tabs for yourself, or disable `terminal.integrated.enablePersistentSessions` to stop the editor restoring dead tabs at all.

Settings:

| Setting                                          | Default  | Meaning                                                                    |
| ------------------------------------------------ | -------- | -------------------------------------------------------------------------- |
| `claudeResurrect.restoreOnStartup`               | `ask`    | `ask`, `always` or `never`                                                 |
| `claudeResurrect.claudeCommand`                  | `claude` | Command used to launch Claude Code                                         |
| `claudeResurrect.extraArguments`                 | `[]`     | Extra arguments appended after the resume flag                             |
| `claudeResurrect.shutdownWindowSeconds`          | `120`    | How close together interruptions must be to count as one shutdown          |
| `claudeResurrect.terminalLocation`               | `editor` | `editor` or `panel`                                                        |
| `claudeResurrect.reuseRestoredTerminals`         | `true`   | Resume inside an idle restored tab, preferring one in the session's folder |
| `claudeResurrect.compaction.enabled`             | `false`  | Opt in to compacting the event log on startup when it is large and quiet   |
| `claudeResurrect.compaction.thresholdKb`         | `256`    | Compact only above this size                                               |
| `claudeResurrect.compaction.quietSeconds`        | `60`     | Compact only when nothing was written for this long                        |
| `claudeResurrect.compaction.keepInterruptedDays` | `30`     | Drop interrupted sessions older than this during compaction                |

The log is append-only, so it grows with every session start and end. Compaction folds it into one snapshot line. It waits for a quiet period because a rewrite that overlaps with a session starting up could lose that session's start event.

## What is stored

Only metadata, on your machine, in your Claude config directory: session id, working directory, transcript path, the user-given session name if any, and timestamps with the start source and end reason. To label sessions in a list or menu, the title Claude Code gave the conversation and its last prompt are read from the tail of the transcript at display time. Nothing from the transcript is stored, and nothing is sent over the network.

## Repository layout

This is an npm workspace with one package per editor plus the shared core:

- `packages/core`: everything editor-independent. The Claude Code hook, the event log and its folding, the restore planner, claims, lost-session recovery and the settings installer. Private, bundled into the editor packages.
- `packages/vscode`: the VS Code and Cursor extension. Its README is the marketplace page.
- `packages/zed`: the `claude-resurrect-zed` CLI for Zed, where extensions cannot open terminals. A shell snippet or a Zed task resumes sessions in restored tabs. Its README is the npm page.

## Development

To run the extension from a checkout instead of a registry:

```sh
git clone https://github.com/jakubmichalec/claude-resurrect.git
cd claude-resurrect
npm install
npm run package
cursor --install-extension packages/vscode/claude-resurrect-*.vsix   # or: code --install-extension ...
npm run install-hooks            # point Claude Code at the hook in this checkout
npm run sessions                 # print what has been recorded
```

The code is TypeScript in a functional style: plain functions, immutable data, type guards at every boundary, and no classes. esbuild bundles each package into its own `dist/`, and vitest builds core before running the tests that spawn its bundles.

```sh
npm install
npm run build          # every package
npm run typecheck      # tsc --noEmit in every package
npm run lint           # eslint, whole repository
npm run format         # prettier --write
npm test               # vitest in every package
npm run check          # typecheck + lint + format check + tests
npm run package        # build the .vsix in packages/vscode
```

Core layout:

- `src/state.ts`: event log, session folding, pruning and compaction
- `src/hook-payload.ts`: the shape of what Claude Code pipes to hooks, with its guard
- `src/hook.ts`: the hook entry point (bundled to `dist/claude-resurrect-hook.js`)
- `src/installer.ts` and `src/install-hooks.ts`: settings merge logic and its CLI
- `src/show-sessions.ts`: prints the folded state
- `src/restore-plan.ts`: decides which sessions a window should offer, pure and fully tested
- `src/registry.ts`: reads Claude Code's live session registry
- `src/lost-sessions.ts`: records sessions that died without a SessionEnd hook
- `src/claims.ts`: makes sure two windows never resume the same session
- `src/maintenance.ts`: compacts the log when it is large and quiet
- `src/node-locator.ts`: finds the Node binary through the login shell
- `src/launch.ts` and `src/processes.ts`: the resume command line and the shell idleness check
- `src/transcript-title.ts`: reads the conversation title and last prompt from a transcript to label a session
- `src/io.ts`: small file and JSON helpers shared by the above

## Releasing

Releases are automated. Merging a pull request to `main` with a Conventional Commit title lets release-please open or update a Release PR; merging that PR tags the version, creates the GitHub Release with the vsix attached, and publishes to Open VSX and the Visual Studio Marketplace. See [CONTRIBUTING.md](CONTRIBUTING.md) for the commit conventions.

One-time setup for a fork or a new maintainer:

1. Create the publisher on both registries: `jakubmichalec` on the [Visual Studio Marketplace](https://marketplace.visualstudio.com/manage) and the same namespace on [Open VSX](https://open-vsx.org/) with `npx ovsx create-namespace jakubmichalec -p <token>`.
2. Add the repository secrets `VSCE_PAT` (Azure DevOps token with Marketplace publish scope), `OVSX_TOKEN` (Open VSX access token), `NPM_TOKEN` (npm automation token for `claude-resurrect-zed`) and `GH_PAT` (fine-grained token for the Release PR, see `.github/rulesets/README.md`).
3. Run `bash scripts/github-repo-settings.sh` to apply the rulesets from `.github/rulesets/` and the security settings listed there.

## Contributing

Bug reports and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first; security issues go through [SECURITY.md](SECURITY.md).

## License

MIT
