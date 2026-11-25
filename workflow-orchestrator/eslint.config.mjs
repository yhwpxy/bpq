import gts from 'gts';

export default [
  {
    ignores: [
      'dist/**',
      'renderer/dist/**',
      'release/**',
      'node_modules/**',
      '.orchestrator/**',
    ],
  },
  ...gts,
  {
    files: ['renderer/src/**/*.{ts,tsx}', 'renderer/vite.config.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.renderer.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.mjs'],
    rules: {
      'n/no-unsupported-features/node-builtins': 'off',
      'n/no-missing-import': 'off',
      'n/no-extraneous-import': 'off',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'n/no-unsupported-features/node-builtins': 'off',
      'n/no-missing-import': 'off',
      'n/no-extraneous-import': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['verify/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            {
              from: 'package',
              package: 'node:test',
              name: [
                'describe',
                'it',
                'test',
                'before',
                'after',
                'beforeEach',
                'afterEach',
              ],
            },
          ],
        },
      ],
    },
  },
];
