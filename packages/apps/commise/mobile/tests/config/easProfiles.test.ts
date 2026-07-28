/**
 * Every EAS build profile must embed the endpoints for the stage it targets — and a shippable profile
 * must never embed a loopback address.
 *
 * ## Why this guard exists
 *
 * `EXPO_PUBLIC_*` is inlined by Babel at BUILD time, so whatever `eas.json` says when the binary is built
 * is frozen into that binary forever. `src/config/env.ts` deliberately has no defaults, so a profile that
 * forgets an endpoint fails the build loudly — but a profile that names the WRONG endpoint fails silently
 * and ships. That is precisely how the web app reached the sandbox preview with `http://localhost:3000`
 * compiled into its bundle, and it is worse on a phone: `localhost` there is the PHONE itself, so every
 * request dies with no route to host and no clue why.
 *
 * The `e2e` profile is the deliberate exception. It targets `10.0.2.2` — the Android emulator's alias for
 * the host loopback — because the Maestro suite runs against services on the CI runner. That is a loopback
 * on purpose, and only for a profile that is never distributed.
 */
import { describe, expect, it } from 'vitest';

import easConfig from '../../eas.json' with { type: 'json' };

interface BuildProfile {
    readonly env?: Readonly<Record<string, string>>;
}

const profiles = easConfig.build as unknown as Readonly<Record<string, BuildProfile>>;

/** Profiles that produce a binary someone installs — these must point at real, remote infrastructure. */
const SHIPPABLE = ['preview', 'production'] as const;

const ENDPOINTS = ['EXPO_PUBLIC_RECIPE_API_URL', 'EXPO_PUBLIC_IDENTITY_API_URL'] as const;

describe('eas.json build profiles', () => {
    it.each([...SHIPPABLE, 'e2e'])('%s declares every endpoint the app reads', (name) => {
        const env = profiles[name]?.env;

        expect(env, `profile "${name}" has no env block`).toBeDefined();

        for (const key of ENDPOINTS) {
            expect(env?.[key], `${name} is missing ${key}`).toBeTruthy();
        }
    });

    it.each(SHIPPABLE)('%s points at remote infrastructure, never a loopback', (name) => {
        const env = profiles[name]?.env ?? {};

        for (const key of ENDPOINTS) {
            const value = env[key] ?? '';

            // `localhost`/`127.0.0.1` on a device is the DEVICE; `10.0.2.2` is the emulator's host alias.
            // None of the three can be reached from a real user's phone.
            expect(value, `${name}.${key} embeds a loopback address`).not.toMatch(/localhost|127\.0\.0\.1|10\.0\.2\.2/);
            expect(value, `${name}.${key} must be an absolute https URL`).toMatch(/^https:\/\//);
        }
    });

    it('keeps sandbox and production pointed at DIFFERENT hosts', () => {
        // A copy-paste that leaves `production` on the sandbox hosts would send real users' data to the
        // throwaway environment — silently, since both are valid https URLs that resolve.
        for (const key of ENDPOINTS) {
            expect(profiles.preview?.env?.[key]).not.toBe(profiles.production?.env?.[key]);
        }
    });

    it('targets the emulator host loopback for the e2e profile (deliberate, never distributed)', () => {
        for (const key of ENDPOINTS) {
            expect(profiles.e2e?.env?.[key]).toMatch(/^http:\/\/10\.0\.2\.2:/);
        }
    });
});
