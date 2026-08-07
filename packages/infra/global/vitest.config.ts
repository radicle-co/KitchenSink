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
            // explicit coverage in `cdk-nag-synth.integration.test.ts`, which shells out to
            // `cdk synth --app "node dist/bin/app.js"`.
            '@kitchensink/infra-security': fileURLToPath(new URL('../security/src/index.ts', import.meta.url)),
        },
    },
    test: {
        include: ['__tests__/**/*.test.ts'],
        exclude: ['node_modules', 'dist', 'cdk.out'],
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
