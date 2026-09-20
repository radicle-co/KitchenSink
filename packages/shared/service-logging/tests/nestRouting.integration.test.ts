/**
 * THE TEST THAT FAILS ON THE COMMIT BEFORE THIS ONE.
 *
 * ⛔ WHAT IT CROSSES, AND WHY A UNIT TEST CANNOT. `NestRoutedLogger.test.ts` proves the adapter's five
 * methods against a stubbed sink. It says nothing about the two framework behaviours this whole step rests
 * on, because both live inside Nest:
 *
 *  1. `NestFactory.create(mod, { logger })` installs the adapter as Nest's static logger, so the framework's
 *     OWN output — the bootstrap banner, module initialisation, route mapping — stops going to stdout raw
 *     and comes through the routing rule instead.
 *  2. `Logger` resolves that static at CALL time. An instance constructed at MODULE LOAD, before the app
 *     exists, therefore routes through the adapter too. That is the property the decision not to edit 19
 *     `new Logger(X.name)` call sites depends on entirely, and it is a fact about `@nestjs/common`'s
 *     internals — exactly the kind of assumption CLAUDE.md §7.1 says a mocked test structurally cannot
 *     check.
 *
 * ⛔ AND IT RUNS WITH NO DSN, which is the defect's own condition. `identity/src/observability/sentryLogging.ts`
 * shipped on this branch writing NOTHING to stdout; with no client `Sentry.logger.*` returns before
 * emitting, so a service booted this way produced no bootstrap line, no route line and no error line at all
 * — a `pr-{N}` operator running `aws logs tail` saw an empty stream, indistinguishable from a task that
 * never started. Every assertion below is on the presence of output that adapter deleted.
 */
import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Injectable, Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { NestRoutedLogger } from '../src/NestRoutedLogger.js';

/**
 * ⛔ CONSTRUCTED AT MODULE LOAD — before `NestFactory.create` has been called, and deliberately so. This is
 * the shape of `recipe-service/src/photos/cdnInvalidation.ts:33`'s module-level `const logger = new
 * Logger('CloudFrontInvalidation')`, and if the static were bound at construction it would be the one call
 * site that escapes the routing.
 */
const moduleLevelLogger = new Logger('ConstructedBeforeBootstrap');

class ProbeService {
    private readonly logger = new Logger(ProbeService.name);

    /** @sideEffect Emits through whatever logger Nest currently holds. */
    public emit(): void {
        this.logger.warn('nutrition degraded', { reason: 'deadline', recovered: 3 });
        this.logger.error('photos failed', 'RENDERED-CAUSE-CHAIN');
    }
}

class ProbeModule {}

// ⚠️ THE DECORATORS ARE APPLIED AS FUNCTIONS, not with `@` syntax. `@Module`/`@Injectable` are ordinary
// higher-order functions, and calling them directly is exactly what the syntax compiles to — but it does
// not require this package to adopt a decorator transform in its test toolchain for two annotations. What
// is under test is Nest's LOGGER binding, not its decorator metadata.
Injectable()(ProbeService);
Module({ providers: [ProbeService] })(ProbeModule);

/** Every line written to the console during a case, as `[method, text]`. */
let written: Array<[string, string]> = [];

describe('a real Nest app routed through the shared logger, with no SENTRY_DSN', () => {
    beforeEach(() => {
        written = [];

        for (const method of ['error', 'info'] as const) {
            vi.spyOn(console, method).mockImplementation((line: unknown) => {
                written.push([method, String(line)]);
            });
        }
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    /** Parsed JSON lines, ignoring anything that is not one. */
    function lines(): Array<Record<string, unknown>> {
        return written.flatMap(([, text]) => {
            try {
                return [JSON.parse(text) as Record<string, unknown>];
            } catch {
                return [];
            }
        });
    }

    it("⛔ routes Nest's OWN bootstrap output through the rule instead of raw to stdout", async () => {
        const app = await NestFactory.create(ProbeModule, { logger: new NestRoutedLogger() });

        await app.init();
        await app.close();

        // Every line is ours: parseable JSON with a level, not Nest's ANSI-coloured `[Nest] … LOG […]`.
        expect(written.length).toBeGreaterThan(0);
        expect(lines()).toHaveLength(written.length);
        expect(lines().every((line) => typeof line['level'] === 'string')).toBe(true);
    });

    it('⛔ routes a Logger constructed BEFORE the app existed — the late binding the 19 sites rely on', async () => {
        const app = await NestFactory.create(ProbeModule, { logger: new NestRoutedLogger() });

        await app.init();
        moduleLevelLogger.log('from an instance made at module load');
        await app.close();

        expect(lines()).toContainEqual(
            expect.objectContaining({
                message: 'from an instance made at module load',
                context: 'ConstructedBeforeBootstrap',
            }),
        );
    });

    it('⛔ keeps a provider’s structured attributes as attributes, and its error on stderr', async () => {
        const app = await NestFactory.create(ProbeModule, { logger: new NestRoutedLogger() });

        await app.init();
        app.get(ProbeService).emit();
        await app.close();

        expect(lines()).toContainEqual(
            expect.objectContaining({
                level: 'warn',
                message: 'nutrition degraded',
                reason: 'deadline',
                recovered: 3,
                context: 'ProbeService',
            }),
        );

        const failure = written.find(([, text]) => text.includes('photos failed'));

        expect(failure?.[0]).toBe('error');
        expect(failure?.[1]).toContain('RENDERED-CAUSE-CHAIN');
    });
});
