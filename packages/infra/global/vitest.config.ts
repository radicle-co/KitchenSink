import { testTempRootSetup } from '@kitchensink/vitest';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            // `@kitchensink/infra-security` exports BUILT js (`dist/`), because prod-deploy runs the CDK
            // entrypoints as compiled JS under plain `node` — see ADR-0013. Resolving the bare specifier to
            // `dist/` in tests too would mean the suites assert against whatever was last built, so an edit
            // to the Aspect could pass a stale-dist run: exactly the false green a template-parity guard
            // must not have. Tests therefore run the SOURCE, and the compiled artifact gets its own,
            // explicit coverage in `cdkNagSynth.integration.test.ts`, which shells out to
            // `cdk synth --app "node dist/bin/app.js"`.
            '@kitchensink/infra-security': fileURLToPath(new URL('../security/src/index.ts', import.meta.url)),

            // `k6/http` lives inside the k6 binary's Go runtime — there is no npm package, so vitest cannot
            // resolve the specifier and any test importing a k6 module fails at collection. The stub lets
            // `loadtest/k6/session.js` (the mid-run Clerk re-mint, whose ABSENCE cost run 34041143051 every
            // authenticated request after the first 60 seconds) be tested for BEHAVIOUR rather than only
            // for being wired up.
            'k6/http': fileURLToPath(new URL('__tests__/support/k6HttpStub.ts', import.meta.url)),
        },
    },
    test: {
        // ⛔ Confines this run's temp directories to one removable root — CDK's own `cdk.out*`
        // synth dirs and every `mkdtempSync(tmpdir())` fixture. Asserted by `vitestTempRoot.test.ts`.
        globalSetup: [testTempRootSetup],
        include: ['__tests__/**/*.test.ts'],
        // `tests/**` is the INTEGRATION tier (`vitest.integration.config.ts`) — excluded by path AND
        // by suffix so a `*.integration.test.ts` left in `__tests__/` cannot rejoin the unit run,
        // which is exactly how six process-spawning specs ended up racing the unit tests.
        exclude: ['tests/**', '**/*.integration.test.ts', 'node_modules', 'dist', 'cdk.out'],
        typecheck: {
            enabled: false,
        },
        // CDK stack synthesis is CPU-heavy and runs fast locally (~1s) but intermittently exceeds the
        // 5s default under the parallel turbo test load on CI runners. Give synth-backed assertions
        // realistic headroom so a slow-but-correct synth is never a false timeout failure.
        testTimeout: 30_000,
        hookTimeout: 30_000,
    },
});
