const js = require('@eslint/js');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const prettier = require('eslint-config-prettier');

// Plain JS at the repo root (this config, scripts/) runs on Node.
const NODE_GLOBALS = {
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  __dirname: 'readonly',
  __filename: 'readonly',
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
};

module.exports = [
  { ignores: ['**/dist/', '**/node_modules/', '**/*.vsix'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: NODE_GLOBALS },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: NODE_GLOBALS },
  },
  {
    files: ['**/*.ts', '**/*.mts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      // TypeScript owns undefined-name and unused-symbol checks for .ts files
      ...tsPlugin.configs['eslint-recommended'].overrides[0].rules,
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'as' }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      'func-style': ['error', 'expression'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    // Production code must not paper over nullability; tests may reach into fixtures with `!`
    files: ['packages/*/src/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'error' },
  },
  prettier,
];
