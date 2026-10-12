# Contributing

Thanks for contributing! A few conventions keep this repo healthy.

## Development

```bash
npm install
npm run build          # every package: hook and CLIs in core, the extension in vscode
npm test               # unit tests in every package (vitest)
npm run typecheck
npm run lint && npm run format:check
npm run check          # all of the above
npm run package        # build the .vsix in packages/vscode
```

The repository is an npm workspace:

- `packages/core`: everything editor-independent. The Claude Code hook, the
  event log, the restore planner, claims, lost-session recovery and the
  settings installer. Private, bundled into the editor packages.
- `packages/vscode`: the VS Code and Cursor extension.
- `packages/zed`: the `claude-resurrect-zed` CLI, shell snippet and Zed task.

Put logic in core whenever it does not need an editor API, with tests next
to it. Editor packages stay thin. Commit scopes follow the package names:
`feat(core): ...`, `fix(vscode): ...`, `feat(zed): ...`.

Husky hooks (installed by `npm install` via the `prepare` script): `commit-msg`
runs commitlint on every commit message, and `pre-push` runs the full check
before every push.

To try a change in the editor, run `npm run package` and install the vsix with
`cursor --install-extension packages/vscode/claude-resurrect-*.vsix` (or
`code`), then reload the window. The hook that Claude Code runs is
`packages/core/dist/claude-resurrect-hook.js`; point your
`~/.claude/settings.json` at the checkout with `npm run install-hooks` while
developing.

## Code style

TypeScript in a functional style: plain functions and arrow functions, immutable
data with `readonly`, early returns, exhaustive `switch` with a `never` default,
type guards instead of `as` at every boundary (hook stdin, log lines, settings
files), and no classes. Everything that touches the editor stays in
`packages/vscode/src/extension.ts`; the decision logic lives in pure modules
in `packages/core` with tests.

Claude Code's session registry under `~/.claude/sessions` is an internal of
Claude Code. Reading it is best effort only and must degrade to "unknown"
rather than fail.

## Commit messages, changelog and releases

Commit subjects and pull request titles follow
[Conventional Commits](https://www.conventionalcommits.org/):
`type(scope)?: subject`, for example `feat(restore): offer sessions from a
second shutdown` or `fix(hook): tolerate a missing transcript path`. The pull
request title becomes the squash commit subject and the changelog line, so
write it for users of the extension.

[release-please](https://github.com/googleapis/release-please) derives the
version from merged titles (`feat:` minor, `fix:` and `perf:` patch, `!` or a
`BREAKING CHANGE:` footer major) and maintains a Release PR that updates
`package.json` and `CHANGELOG.md`. Merging the Release PR tags the release,
creates the GitHub Releases with the vsix attached, publishes the extension to
Open VSX and the Visual Studio Marketplace, and publishes the Zed package to
npm. All packages share one version number
(release-please links them), so one Release PR covers the whole repository. Do not edit the version or `CHANGELOG.md`
for a release by hand; `chore:`, `ci:`, `docs:` and `test:` titles stay out of
the changelog.
