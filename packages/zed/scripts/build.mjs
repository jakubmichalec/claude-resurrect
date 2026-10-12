import { build } from 'esbuild';

// One CLI with subcommands, plus the hook so a global install of this
// package can register it without the editor extension.
await build({
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  logLevel: 'warning',
  outdir: 'dist',
  entryPoints: {
    cli: 'src/cli.ts',
    'claude-resurrect-hook': '../core/src/hook.ts',
  },
  banner: { js: '#!/usr/bin/env node' },
});
