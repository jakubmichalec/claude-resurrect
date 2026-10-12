# Claude Resurrect

Bring back the [Claude Code](https://code.claude.com) CLI sessions that were open in your editor terminals before a restart.

If you run many `claude` sessions in Cursor or VS Code terminals, a reboot or editor quit kills all of them, and getting back to work means remembering which sessions were open where and running `claude -r <id>` for each one. Claude Resurrect records which sessions were running, tells apart "the editor quit" from "I closed this one", and reopens the interrupted ones in editor-area terminals of the right window.

This is an independent community project. It is not affiliated with or endorsed by Anthropic.

## Installing

Search for "Claude Resurrect" in the Extensions view, or install from [Open VSX](https://open-vsx.org/extension/jakubmichalec/claude-resurrect) for Cursor and other forks, or the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=jakubmichalec.claude-resurrect) for VS Code. Zed users: see [claude-resurrect-zed](https://www.npmjs.com/package/claude-resurrect-zed).

## How it works

1. Two Claude Code hooks, `SessionStart` and `SessionEnd`, append one line each to a local event log at `~/.claude/resurrect/events.jsonl`. The extension offers to install them on first activation and shows the exact command it will add to `~/.claude/settings.json`.
2. `SessionEnd` carries a reason. `/exit`, Ctrl-C and Ctrl-D produce `prompt_input_exit`, so the session is dropped from the log. A SIGHUP from the editor quitting or the machine restarting produces `other`, so the session is kept and marked interrupted. Sessions killed so hard that the hook never ran are recovered from Claude Code's session registry and from the log itself.
3. When a window opens, the extension lists the interrupted sessions whose working directory belongs to that window, with every entry ticked. Press Enter to restore them, untick the ones to leave closed, or press Escape to skip.
4. Each session is resumed with `claude -r <id>`, inside an idle terminal tab the editor restored when one exists, otherwise in a new editor-area terminal.

In `always` mode only sessions killed by the same shutdown are restored. In `ask` mode the list shows every interrupted session for the window, oldest first, so nothing is hidden and you untick what you do not want. A session you closed by hand with `/exit` stays closed either way.

## Commands

- Claude Resurrect: Restore Sessions
- Claude Resurrect: Install Claude Code Hooks

## Settings

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

## What is stored

Only metadata, on your machine, in your Claude config directory: session id, working directory, transcript path, the user-given session name if any, and timestamps with the start source and end reason. To label a session in the list, the extension reads the title Claude Code gave the conversation and its last prompt from the tail of the transcript at display time. Nothing from the transcript is stored, and nothing is sent over the network.

## Requirements

Node 18 or newer on your PATH, for the hook that Claude Code runs. The extension finds it through your login shell.

## License

MIT
