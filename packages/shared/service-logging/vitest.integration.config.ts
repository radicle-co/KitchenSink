import { defineConfig } from 'vitest/config';

/**
 * Integration tier for `@kitchensink/service-logging`.
 *
 * ⛔ IT NEEDS NO DOCKER AND NO NETWORK, and that is not a reason to fold it into the unit run. What it
 * crosses is the NEST FRAMEWORK: it boots a real module through `NestFactory.create` so the assertion is
 * about what Nest does with an overridden logger, not about what this package believes Nest does. A unit
 * test mocking `LoggerService` proves the adapter's five methods and can say nothing about
 * `Logger.overrideLogger`'s late binding — the property the whole "do not edit 19 call sites" decision
 * rests on.
 *
 * Kept out of the default glob (`src/**`) so a framework boot never lands in the unit run.
 */
export default defineConfig({
    test: {
        include: ['tests/**/*.integration.test.ts'],
        exclude: ['node_modules', 'dist'],
        typecheck: { enabled: false },
        testTimeout: 30_000,
    },
});
