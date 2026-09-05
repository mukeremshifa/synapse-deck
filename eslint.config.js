import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist', 'src/types/database.ts'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Card content is untrusted LLM output (SPEC §10). Enforce, don't trust memory.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
          message:
            'Card content is untrusted LLM output. Render it as text; never as HTML.',
        },
      ],
    },
  },
  // CDK. Node globals rather than browser ones — the base block above sets
  // globals.browser, so without this every `process` reference is a lint error.
  //
  // Deliberately NOT an `ignores` entry. Ignoring infra/ is the tempting fix and
  // the wrong one: it would leave a second TypeScript codebase that nothing
  // lints, which is exactly the gap that let the Edge Function break CI while
  // `verify` stayed green locally.
  {
    files: ['infra/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  // Deno-based Edge Functions have their own globals and are typechecked by Deno,
  // not by tsc/eslint here.
  { ignores: ['supabase/functions/**'] },
);
