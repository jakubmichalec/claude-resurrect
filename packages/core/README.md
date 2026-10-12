# @claude-resurrect/core

Shared, editor-independent logic for Claude Resurrect: the Claude Code hook
that records session starts and ends, the append-only event log and its
folding, the restore planner, claims that stop two windows resuming the same
session, lost-session recovery, and the settings installer.

This package is private and is bundled into the editor packages. The hook
Claude Code runs is built to `dist/claude-resurrect-hook.js`.

```sh
npm run build          # bundle the hook and the helper CLIs into dist/
npm run install-hooks  # register the hook in ~/.claude/settings.json
npm run sessions       # print what has been recorded
npm test
```
