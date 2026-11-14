import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['out/', 'release*/', 'node_modules/', 'coverage/', 'playwright-report/', 'test-results/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // electron-builder loads afterPack hooks with require(), so the hook stays CommonJS.
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  },
  {
    files: ['**/*.{ts,tsx,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error'
    }
  }
);
