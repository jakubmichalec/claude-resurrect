import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  logLevel: 'warning',
  outdir: 'dist',
};

// The extension itself. The vscode module is provided by the host at runtime.
const extension = build({
  ...shared,
  entryPoints: { extension: 'src/extension.ts' },
  external: ['vscode'],
});

// The hook that Claude Code runs, shipped inside the extension so the
// in-editor installer can point Claude at it.
const hook = build({
  ...shared,
  entryPoints: { 'claude-resurrect-hook': '../core/src/hook.ts' },
  banner: { js: '#!/usr/bin/env node' },
});

await Promise.all([extension, hook]);
