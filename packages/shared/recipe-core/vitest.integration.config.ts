import { defineConfig } from 'vitest/config';

// ⚠️ A RELATIVE import, on purpose. The pin is `@kitchensink/service-test-harness/integration-aws-pin`, but that package
// declares recipe-core as a peer and a dev dependency, so recipe-core depending on it back is a cycle Turborepo refuses
// (measured: `recipe-core#build -> service-test-harness#build -> recipe-core#build`). The pin module imports only
// through its own package's `#` map, so it loads from here unchanged (`awsTierPins.test.ts` loads this config as vitest
// does). Why recipe-core needs a pin at all: its dev script `foodnessHoldoutRun.ts` makes it a package that can reach
// the AWS SDK, and this tier builds no AWS client.
import { INTEGRATION_AWS_PIN } from '../../tools/service-test-harness/src/integrationAwsPin.ts';

/**
 * Integration tier for `@kitchensink/recipe-core`. These specs import the page reader by its package export
 * (`@kitchensink/recipe-core/page-reader`), so they run through the `exports` map and cross the real htmlparser2 and
 * tinyduration, over a whole synthetic page. Nothing is mocked. Kept OUT of the default `test` task (whose glob is
 * `**\/__tests__/**`) so it never bleeds into the unit run; it runs via `npm run test:integration` and in CI.
 * Self-contained: no Docker, no network, no external service.
 */
export default defineConfig({
    test: {
        // The integration AWS pin (`@kitchensink/service-test-harness`'s `awsPin.ts`).
        env: { ...INTEGRATION_AWS_PIN.env },
        setupFiles: [...INTEGRATION_AWS_PIN.setupFiles],
        include: ['tests/**/*.integration.test.ts'],
        typecheck: { enabled: false },
    },
});
