import { defineConfig } from 'vitest/config';

/**
 * Integration tier for `@kitchensink/page-reader`. These specs import the reader by its package name, so they run through the `exports` map and cross the real htmlparser2,
 * tinyduration and @noble/hashes, over a whole synthetic page. Nothing is mocked. Kept OUT of the default `test` task
 * (whose glob is `**\/__tests__/**`) so it never bleeds into the unit run; it runs via `npm run test:integration` and
 * in CI. Self-contained: no Docker, no network, no external service. This package declares no AWS SDK, so this tier needs
 * no AWS pin (`awsTierPins.test.ts`).
 */
export default defineConfig({
    test: {
        include: ['tests/**/*.integration.test.ts'],
        typecheck: { enabled: false },
    },
});
