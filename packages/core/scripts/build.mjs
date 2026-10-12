import { build } from 'esbuild';

// Node entry points: the hook that Claude Code runs and the helper CLIs.
await build({
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  logLevel: 'warning',
  outdir: 'dist',
  entryPoints: {
    'claude-resurrect-hook': 'src/hook.ts',
    'install-hooks': 'src/install-hooks.ts',
    'show-sessions': 'src/show-sessions.ts',
  },
  banner: { js: '#!/usr/bin/env node' },
});
