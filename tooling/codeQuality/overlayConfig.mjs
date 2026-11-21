// staff-code-quality — overlay lint run by the CI code-quality job.
//
// This NEVER replaces the repository's own ESLint config. It layers the rule families the repo leaves off —
// type-checked typescript-eslint, SonarJS, React + React Hooks (Compiler-era rules), jsx-a11y, Next, Node, Promise,
// Security. An error-severity finding on a changed line fails the `Code quality scanners` CI check (scanVerdict.mjs).
//
// It lives in tooling/codeQuality (= $SCQ_HOME) so every bare import resolves from the pinned toolchain,
// not from the target repository. scan.mjs drives it through environment variables:
//   SCQ_TSCONFIG_ROOT  package root holding tsconfig.json (type-aware mode only)
//   SCQ_TYPE_AWARE     '1' → strictTypeChecked with projectService; otherwise syntactic `strict`
//   SCQ_NEXT           '1' → add @next/eslint-plugin-next core-web-vitals rules
//   SCQ_REACT_VERSION  e.g. '19.2' — REQUIRED to be explicit: eslint-plugin-react 7.37.5's `version: 'detect'`
//                      calls `context.getFilename`, which ESLint 10 removed, and crashes the whole run.
import nextPlugin from '@next/eslint-plugin-next';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import nodePlugin from 'eslint-plugin-n';
import promise from 'eslint-plugin-promise';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';

const typeAware = process.env['SCQ_TYPE_AWARE'] === '1';
const tsconfigRootDir = process.env['SCQ_TSCONFIG_ROOT'] ?? process.cwd();
const code = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];
const ts = ['**/*.{ts,tsx,mts,cts}'];
const jsx = ['**/*.{tsx,jsx}'];

const typescriptLayer = typeAware
    ? [
          ...tseslint.configs.strictTypeChecked.map((c) => ({ ...c, files: ts })),
          { files: ts, languageOptions: { parserOptions: { projectService: true, tsconfigRootDir } } },
      ]
    : tseslint.configs.strict.map((c) => ({ ...c, files: ts }));

export default [
    { ignores: ['**/dist/**', '**/.next/**', '**/build/**', '**/coverage/**', '**/node_modules/**', '**/*.d.ts'] },
    ...typescriptLayer,
    { ...sonarjs.configs.recommended, files: code },
    {
        files: jsx,
        plugins: { react, 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
        settings: { react: { version: process.env['SCQ_REACT_VERSION'] ?? '19.0' } },
        languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
        rules: {
            ...reactHooks.configs.recommended.rules,
            ...jsxA11y.flatConfigs.recommended.rules,
            'react/no-unstable-nested-components': 'error',
            'react/jsx-no-constructed-context-values': 'error',
            'react/no-array-index-key': 'error',
            'react/jsx-no-leaked-render': 'error',
            'react/no-danger': 'error',
            'react/jsx-no-useless-fragment': 'warn',
            'react/no-object-type-as-default-prop': 'error',
            'react/jsx-key': 'error',
        },
    },
    ...(process.env['SCQ_NEXT'] === '1'
        ? [
              {
                  files: code,
                  plugins: { '@next/next': nextPlugin },
                  rules: { ...nextPlugin.configs.recommended.rules, ...nextPlugin.configs['core-web-vitals'].rules },
              },
          ]
        : []),
    { ...promise.configs['flat/recommended'], files: code },
    { ...security.configs.recommended, files: code },
    {
        files: code,
        plugins: { n: nodePlugin },
        rules: { 'n/no-sync': 'warn', 'n/handle-callback-err': 'warn', 'n/no-process-exit': 'warn' },
    },
];
