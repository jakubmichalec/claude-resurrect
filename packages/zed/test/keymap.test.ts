import { describe, expect, it } from 'vitest';
import { bindingLine, hasKeybinding, withKeybinding, withoutKeybinding } from '../src/keymap';

const existing = `// Zed keymap
[
  {
    "context": "Workspace",
    "bindings": {
      "ctrl-cmd-t": "workspace::NewCenterTerminal",
    },
  },
  {
    "context": "Editor && vim_mode == insert",
    "bindings": {
      // "j k": "vim::NormalBefore"
    },
  },
]
`;

describe('withKeybinding', () => {
  it('inserts into the existing Workspace block and keeps comments', () => {
    const result = withKeybinding(existing, 'cmd-shift-r');

    expect(result).toContain('// Zed keymap');
    expect(result).toContain('// "j k": "vim::NormalBefore"');
    expect(result.indexOf(bindingLine('cmd-shift-r'))).toBeLessThan(result.indexOf('"ctrl-cmd-t"'));
    expect(hasKeybinding(result)).toBe(true);
  });

  it('adds a Workspace block when there is none', () => {
    const result = withKeybinding(
      '[\n  { "context": "Editor", "bindings": {} },\n]\n',
      'cmd-shift-r',
    );

    expect(result).toContain('"context": "Workspace"');
    expect(result).toContain(bindingLine('cmd-shift-r'));
  });

  it('creates a keymap from scratch', () => {
    expect(withKeybinding('', 'cmd-shift-r')).toContain(bindingLine('cmd-shift-r'));
  });

  it('is idempotent', () => {
    const once = withKeybinding(existing, 'cmd-shift-r');

    expect(withKeybinding(once, 'cmd-shift-r')).toBe(once);
  });

  it('refuses content without an array', () => {
    expect(() => withKeybinding('nonsense', 'cmd-shift-r')).toThrow(/array/);
  });
});

describe('withoutKeybinding', () => {
  it('removes only the binding line', () => {
    const result = withoutKeybinding(withKeybinding(existing, 'cmd-shift-r'));

    expect(result).toBe(existing);
  });
});
