import { fileURLToPath } from 'node:url';

import { baseConfig } from '@kitchensink/vitest';
import { mergeConfig } from 'vitest/config';

/**
 * ⛔ `k6/http` HAS NO NPM PACKAGE. It lives inside the k6 binary's Go runtime, so vitest cannot resolve
 * the specifier and any suite importing a k6 module fails at collection. The alias supplies a recording
 * stub, which is what lets `k6/session.js` — the mid-run Clerk re-mint — be tested for BEHAVIOUR rather
 * than only for being wired up. Its absence cost run 34041143051 every authenticated request after the
 * first sixty seconds, and a wiring-only guard could not have seen it: a refresher that never refreshes
 * is wired identically to one that does.
 */
export default mergeConfig(baseConfig, {
    resolve: {
        alias: {
            'k6/http': fileURLToPath(new URL('__tests__/support/k6HttpStub.ts', import.meta.url)),
        },
    },
});
