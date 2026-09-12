import { createConfig } from '@kitchensink/eslint';

const base = createConfig('./tsconfig.json', import.meta.dirname);

export default [
    ...base,
    {
        /**
         * The ONE exemption in this package, granted by PATH so it stays visible and bounded rather than being
         * disabled inline at each of the four call sites.
         *
         * Four suites here unit-test a PURE function exported by a repo-root `scripts/*.mjs` module —
         * `classifyDrift` from `contractDriftGate.mjs`, `discoverContractOwners`/`parseDelegatedWorkspace` from
         * `contractOwners.mjs`, `documentsNotRegenerated` from `contractGenerate.mjs`, `rewriteExports`/
         * `toProductionManifest` from `prepareProdManifest.mjs` — by importing it, which is the only way to
         * assert on a decision function rather than on a subprocess's stdout.
         *
         * `import-x/no-relative-packages` reports each one and its suggested remedy does not exist: it proposes
         * `kitchensink/scripts/contractDriftGate.mjs`, but `kitchensink` is the PRIVATE workspace ROOT — npm
         * links workspace members into `node_modules`, never the root itself, and the root manifest publishes no
         * `exports` map. That specifier is unresolvable, so the rule here has no reachable compliant form.
         *
         * Scoped to `__tests__/` and left ON everywhere else in the package, so a `lib/` stack or a `src/`
         * handler still cannot reach across a package boundary by relative path. The rule's real target — a
         * sibling WORKSPACE reached through `../../`, which needs no manifest entry and so slips past
         * `turbo boundaries` entirely — is unaffected: repo-root `scripts/` is not a workspace.
         *
         * The durable fix is to give those scripts a workspace of their own (`packages/tools/repo-scripts`),
         * which would delete this block. It is out of scope here because the paths `scripts/*.mjs` are named
         * from a dozen workflow steps and npm scripts, and moving them is its own change.
         */
        files: ['__tests__/**/*.ts'],
        rules: {
            'import-x/no-relative-packages': 'off',
        },
    },
];
