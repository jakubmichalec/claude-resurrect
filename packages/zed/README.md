# claude-resurrect-zed

Bring back the [Claude Code](https://code.claude.com) CLI sessions that were open in your Zed terminals before a restart.

Zed extensions cannot open terminals or type into them, so this package takes a different route from the VS Code extension in the same repository: the shell that Zed starts in a restored terminal tab asks a small CLI whether an interrupted session belongs there, and resumes it. The same Claude Code hooks, event log and restore rules are shared with the editor extension, so Cursor and Zed can be open at the same time without resuming a session twice.

This is an independent community project. It is not affiliated with or endorsed by Anthropic.

## Setup

```sh
npm install -g claude-resurrect-zed
claude-resurrect-zed setup
```

`setup` does four things, each idempotent and each with a backup of the file it touches:

1. Registers the Claude Code hooks in `~/.claude/settings.json`.
2. Adds the task "Claude Resurrect: next session" to `~/.config/zed/tasks.json`. It opens the menu of pending sessions in a new tab in the editor area (`--terminal dock` for the terminal panel instead).
3. Adds `eval "$(claude-resurrect-zed shell-init)"` to your shell startup file (`~/.zshrc`, `~/.bashrc` or fish's `config.fish`, chosen from `$SHELL`; override with `--rc <path>`), inside a marked block.
4. Binds `cmd-shift-r` to the task in `~/.config/zed/keymap.json` (override with `--key <binding>`). The file is edited as text, so comments and trailing commas survive.

`teardown` reverses all four. Each step is also available on its own, see the commands below.

**What the shell line does.** Every time Zed starts a terminal, the snippet checks whether an interrupted session belongs to that folder. In zsh the input line is filled once the prompt is up: with one pending session it holds `claude -r <id>`, with several it holds `claude-resurrect-zed pick`, which shows a numbered menu with names, folders and times and resumes your choice in that tab. Press Enter to run it, or Ctrl-C to leave the tab as a plain shell. In bash the CLI asks `resume "<name>" in this terminal? [Y/n]` instead. It only acts inside Zed (`TERM_PROGRAM=zed`), in an interactive shell, and never inside a Claude session. Run `setup --mode always` to run the command without waiting, `setup --mode hint` to start nothing in restored tabs and only show a status line pointing at the task (useful when Zed restores tabs somewhere you do not want sessions, such as the terminal panel), or `--mode never` to pause it.

**What the task does.** Each run, from the task picker or the key, opens a new terminal tab with the menu of pending sessions, or straight into the only one, and leaves you in a shell when Claude exits. Press it once per session you want back. Installed with `--mode always` it skips the menu and takes the oldest session.

## Commands

| Command         | Meaning                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| `setup`         | Hooks, task, shell line and key binding in one go (`teardown` reverses it)  |
| `pick`          | Show the menu of pending sessions for this folder and resume the chosen one |
| `next`          | Print the command that resumes the next pending session for this folder     |
| `pending`       | List the sessions that would be offered for this folder                     |
| `forget`        | Drop a session by id, or every pending one with `--all`                     |
| `doctor`        | Check hooks, Node, the shell line, the task and the key binding             |
| `shell-init`    | Print the shell snippet                                                     |
| `install-task`  | Add the Zed task (`uninstall-task` removes it)                              |
| `install-hooks` | Register the Claude Code hooks (`uninstall-hooks` removes them)             |

Options: `--mode ask|always|hint|never`, `--cwd <path>`, `--claude <command>`, `--timeout <seconds>`, `--window <seconds>`, `--key <binding>`, `--rc <path>`, `--terminal center|dock`, for `pick` `--choose <number>` and `--print`, for `forget` `--all`. Run with `--help` for details.

## How sessions are chosen

Claude Code's `SessionEnd` hook reports why a session ended. `/exit`, Ctrl-C and Ctrl-D mean you closed it, so it stays closed. A SIGHUP from Zed quitting or the machine restarting means it was interrupted, so it is offered. Sessions killed so hard that the hook never ran are recovered from Claude Code's session registry and from the log itself. The menu offers every interrupted session in the folder, oldest first, so nothing is hidden. An unattended resume (`always` mode, or the task installed with `--mode always`) only takes sessions interrupted within `--window` seconds of the last interruption, the ones the latest quit or crash actually killed, so an old leftover never starts on its own. `forget <id>` or `forget --all` drops sessions you no longer want; sessions you decline with `n` in bash are dropped the same way.

## What is stored

Only metadata, on your machine, in your Claude config directory: session id, working directory, transcript path, the user-given session name if any, and timestamps. To label sessions in the menu, the title Claude Code gave the conversation and its last prompt are read from the tail of the transcript at display time. Nothing from the transcript is stored, and nothing is sent over the network.

## Where sessions come back

Zed restores a terminal tab where it was: a session started in the bottom terminal panel returns there, one started in a center terminal (`workspace::NewCenterTerminal`) returns as an editor tab. Start sessions in center terminals if you prefer them next to your files. The task opens in the editor area by default.

## Requirements

Node 18 or newer. Zed restores terminal tabs after a restart as fresh shells; if your Zed version does not restore them in their original folders, the printed command includes a `cd`, so subfolder sessions still land in the right place, and the Zed task covers tabs that did not come back.

## License

MIT
