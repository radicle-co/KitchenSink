import { testTempRootSetup } from '@kitchensink/vitest';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // ⛔ Confines this run's temp directories to one removable root — CDK's own `cdk.out*`
        // synth dirs and every `mkdtempSync(tmpdir())` fixture. Asserted by `vitestTempRoot.test.ts`.
        globalSetup: [testTempRootSetup],
        environment: 'node',
        globals: true,
        setupFiles: [],
        include: ['tests/**/*.test.ts'],

        // `src/config/env.ts` validates the app's endpoints at MODULE LOAD and has no defaults, so any
        // screen test that reaches a service client would otherwise die with a configuration error.
        // Expo's own `.env.development` loader is not running under vitest, so state them explicitly —
        // the same reason and the same two values the web app's vitest config uses.
        //
        // Values are irrelevant to assertions (these suites never hit the network); only PRESENCE matters,
        // so a red test means the code is wrong rather than the environment being unset.
        // `tests/config/env.test.ts` overrides them per-case to prove absence still fails loudly.
        env: {
            EXPO_PUBLIC_RECIPE_API_URL: 'http://localhost:3000',
            EXPO_PUBLIC_IDENTITY_API_URL: 'http://localhost:4000',
        },
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*'],
            exclude: ['node_modules', 'dist'],
        },
    },
    resolve: {
        // ⚠️ ABSOLUTE, resolved from THIS file — and the schema alias was BOTH relative AND off by one level.
        //
        // It read `'../../schemas/identity/src/index.ts'`, which points at `packages/apps/schemas/identity` (this
        // file sits at `packages/apps/commise/mobile/`, so two levels up is `packages/apps`, not `packages`). The
        // target has never existed. It cost nothing for as long as `@kitchensink/schema-identity` was reached only
        // with `import type` — erased before resolution ever ran — and surfaced the moment
        // `@commise/features-account` began importing that package's RUNTIME zod, as `Cannot find package`, which
        // reads like a missing dependency rather than a wrong path. `fileURLToPath(new URL(…))` fixes the second
        // half of the trap too: a relative alias TARGET is re-resolved from the IMPORTING file, so it would still
        // have broken for any importer that does not sit at this package's depth.
        alias: {
            '@kitchensink/schema-identity': fileURLToPath(
                new URL('../../../schemas/identity/src/index.ts', import.meta.url),
            ),
            '@commise/features-account': fileURLToPath(new URL('../features/account/src/index.ts', import.meta.url)),
            // Resolve the shared numeric design scale to its source so the token drift guard runs without a
            // built `@commise/ui/dist` (mirrors the workspace-src aliasing used for the other packages above).
            '@commise/ui/scale': fileURLToPath(new URL('../ui/src/tokens/scale.ts', import.meta.url)),
        },
    },
});
