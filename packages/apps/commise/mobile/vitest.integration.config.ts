/**
 * Vitest config for @commise/mobile's INTEGRATION tier (plan 012).
 *
 * Separate from `vitest.config.ts` because a non-unit tier runs through its own config and stays out of the default
 * `test` task (`docs/CODING_STANDARDS.md` §7). Its suites drive a REAL adapter — today the Expo CLI's own config loader
 * and config plugins (`expo config --type introspect`) — and need no device, network, Docker or LocalStack. CI runs it by
 * name: `npm run test:integration --workspace=@commise/mobile`.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        include: ['tests/__integration__/**/*.integration.test.ts'],
        exclude: ['node_modules', 'dist'],
        // Each case spawns the Expo CLI, which loads every config plugin: seconds, not milliseconds.
        testTimeout: 60_000,
        hookTimeout: 60_000,
    },
});
