import { defineConfig } from 'vitest/config';

/**
 * Integration tier for `@kitchensink/clerk-verify`: `verifyClerkToken` over the REAL `@clerk/backend` `verifyToken`,
 * against tokens genuinely RS256-signed by a throwaway local key. No network, no Clerk instance, no secret.
 *
 * Kept out of the default `test` task (whose glob is `**\/__tests__/**`); it runs via `npm run test:integration`
 * (CODING_STANDARDS §7).
 */
export default defineConfig({
    test: {
        include: ['tests/**/*.integration.test.ts'],
    },
});
