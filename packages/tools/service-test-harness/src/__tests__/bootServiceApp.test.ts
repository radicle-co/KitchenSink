/**
 * Unit + integration coverage for the shared {@link bootServiceApp} template (T6 / CP-9).
 *
 * Boots a REAL (minimal) Nest app — not a mock — to prove the extraction from
 * `@kitchensink/identity-service` behaves identically to the original: env precedence
 * (`forcedEnv` always wins, `envDefaults` only fills gaps), an ephemeral-port HTTP listener that
 * actually serves requests, and a `close()` that tears the listener down. This is the ONE place the
 * shared boot mechanics are verified directly; the identity and recipe-service e2e suites additionally
 * exercise it transitively through their own `bootIdentityApp` / `bootRecipeApp` wrappers.
 */
import { Controller, Get, Module } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bootServiceApp, type BootedServiceApp } from '../bootServiceApp.js';

@Controller()
class ProbeController {
    @Get('probe')
    probe(): { echoed: string | undefined } {
        return { echoed: process.env['HARNESS_PROBE_VALUE'] };
    }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

const ENV_KEYS = ['HARNESS_FORCED_KEY', 'HARNESS_DEFAULT_KEY', 'HARNESS_PROBE_VALUE'] as const;

describe('bootServiceApp', () => {
    let booted: BootedServiceApp | undefined;

    beforeEach(() => {
        for (const key of ENV_KEYS) {
            delete process.env[key];
        }
    });

    afterEach(async () => {
        await booted?.close();
        booted = undefined;

        for (const key of ENV_KEYS) {
            delete process.env[key];
        }
    });

    it('boots the app on an ephemeral port and serves a real HTTP request through it', async () => {
        booted = await bootServiceApp({
            loadAppModule: () => Promise.resolve({ AppModule: ProbeModule }),
            forcedEnv: { HARNESS_PROBE_VALUE: 'from-forced-env' },
        });

        expect(booted.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

        const response = await fetch(`${booted.baseUrl}/probe`);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ echoed: 'from-forced-env' });
    });

    it('applies forcedEnv unconditionally, overwriting a pre-existing value', async () => {
        process.env['HARNESS_FORCED_KEY'] = 'pre-existing';

        booted = await bootServiceApp({
            loadAppModule: () => Promise.resolve({ AppModule: ProbeModule }),
            forcedEnv: { HARNESS_FORCED_KEY: 'forced-value' },
        });

        expect(process.env['HARNESS_FORCED_KEY']).toBe('forced-value');
    });

    it('applies envDefaults only when the key is absent, so a caller-set value always wins', async () => {
        process.env['HARNESS_DEFAULT_KEY'] = 'caller-set';

        booted = await bootServiceApp({
            loadAppModule: () => Promise.resolve({ AppModule: ProbeModule }),
            envDefaults: { HARNESS_DEFAULT_KEY: 'should-not-apply' },
        });

        expect(process.env['HARNESS_DEFAULT_KEY']).toBe('caller-set');
    });

    it('applies envDefaults when the key is empty or absent', async () => {
        process.env['HARNESS_DEFAULT_KEY'] = '';

        booted = await bootServiceApp({
            loadAppModule: () => Promise.resolve({ AppModule: ProbeModule }),
            envDefaults: { HARNESS_DEFAULT_KEY: 'default-value' },
        });

        expect(process.env['HARNESS_DEFAULT_KEY']).toBe('default-value');
    });

    it('close() tears the listener down so further requests fail', async () => {
        booted = await bootServiceApp({
            loadAppModule: () => Promise.resolve({ AppModule: ProbeModule }),
        });
        const { baseUrl } = booted;

        await booted.close();
        booted = undefined;

        await expect(fetch(`${baseUrl}/probe`)).rejects.toThrow();
    });
});
