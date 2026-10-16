/**
 * Integration tier for the Expo app config (plan 012): the REAL Expo config loader evaluates `app.config.ts`, runs the
 * REAL config plugins over it, and reports what prebuild would write — with no device, no Xcode and no files written
 * (`expo config --type introspect`).
 *
 * Why this tier exists and a unit import cannot stand in for it: Vitest resolves `.js` specifiers to `.ts` sources,
 * while Expo's config loader does not (plan 012 fact 13 — a value import of a sibling module fails there with
 * `Cannot find module` and passes here). And the two failures this guards are both SILENT at prebuild:
 *
 * - `@clerk/expo-google-signin` writes NO URL scheme when it is not given one, and the iOS Google SDK then fails on tap;
 * - `@clerk/expo`'s `appleSignIn` decides whether the `com.apple.developer.applesignin` entitlement exists at all.
 *
 * So for each Clerk instance the build can be pointed at, this asserts the Info.plist URL scheme, the entitlement and
 * the `extra` the runtime reads — and that the unknown production key is refused by the loader itself.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MOBILE_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const EXPO_CLI = createRequire(import.meta.url).resolve('expo/bin/cli');

function publishableKey(type: 'test' | 'live', host: string): string {
    return `pk_${type}_${Buffer.from(`${host}$`).toString('base64')}`;
}

interface Introspected {
    readonly extra?: Record<string, unknown>;
    readonly ios?: {
        readonly entitlements?: Record<string, unknown>;
        readonly infoPlist?: { readonly CFBundleURLTypes?: readonly { readonly CFBundleURLSchemes?: string[] }[] };
    };
}

/**
 * Run the real loader. The environment is built from scratch apart from PATH/HOME, so no stray
 * `EXPO_PUBLIC_CLERK_GOOGLE_*` of the developer's can change the answer (`app.config.ts` refuses one anyway).
 *
 * @sideEffect Spawns the Expo CLI (it writes nothing: introspect only evaluates).
 */
function introspect(key: string) {
    const result = spawnSync(process.execPath, [EXPO_CLI, 'config', '--type', 'introspect', '--json'], {
        cwd: MOBILE_DIR,
        encoding: 'utf8',
        env: {
            PATH: process.env['PATH'] ?? '',
            HOME: process.env['HOME'] ?? '',
            NODE_ENV: 'test',
            CI: '1',
            EXPO_NO_TELEMETRY: '1',
            EXPO_OFFLINE: '1',
            EXPO_PUBLIC_IDP_PUBLISHABLE_KEY: key,
        },
    });

    return {
        status: result.status,
        stderr: result.stderr,
        config: result.status === 0 ? (JSON.parse(result.stdout) as Introspected) : undefined,
    };
}

const urlSchemesOf = (config: Introspected | undefined) =>
    (config?.ios?.infoPlist?.CFBundleURLTypes ?? []).flatMap((type) => type.CFBundleURLSchemes ?? []);

describe.each([
    [
        'sandbox',
        publishableKey('test', 'nice-fowl-6.clerk.accounts.dev'),
        'com.googleusercontent.apps.191572900034-7umbfpo56atk161tpu88jup50ma0pscg',
        'com.googleusercontent.apps.686681118292-325832urtk1g3077qv5mcdrv8q7sji80',
    ],
    [
        'prod',
        publishableKey('live', 'clerk.commise.app'),
        'com.googleusercontent.apps.686681118292-325832urtk1g3077qv5mcdrv8q7sji80',
        'com.googleusercontent.apps.191572900034-7umbfpo56atk161tpu88jup50ma0pscg',
    ],
])('the %s build, as prebuild would write it', (_stage, key, ownScheme, otherScheme) => {
    const { status, stderr, config } = introspect(key);

    it('loads under Expo’s own config loader', () => {
        expect(status, stderr).toBe(0);
    });

    it('registers THIS instance’s iOS Google URL scheme, and not the other stage’s', () => {
        const schemes = urlSchemesOf(config);

        expect(schemes).toContain(ownScheme);
        expect(schemes).not.toContain(otherScheme);
    });

    it('keeps the app’s own deep-link schemes beside it', () => {
        expect(urlSchemesOf(config)).toEqual(expect.arrayContaining(['commise', 'com.radicle-co.commise']));
    });

    it('carries the Sign in with Apple entitlement', () => {
        expect(config?.ios?.entitlements?.['com.apple.developer.applesignin']).toEqual(['Default']);
    });

    it('hands the runtime the same Google clients the scheme was derived from', () => {
        expect(config?.extra?.['EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME']).toBe(ownScheme);
    });
});

describe('a build pointed at no known instance', () => {
    it('writes no Google URL scheme and turns every provider off (a development key)', () => {
        const { status, stderr, config } = introspect(publishableKey('test', 'other.clerk.accounts.dev'));

        expect(status, stderr).toBe(0);
        expect(urlSchemesOf(config).filter((scheme) => scheme.startsWith('com.googleusercontent.apps.'))).toEqual([]);
        expect(config?.extra?.['socialAuth']).toEqual({ googleIos: false, googleAndroid: false, appleIos: false });
    });

    it('is REFUSED by the loader for a production key', () => {
        const { status, stderr } = introspect(publishableKey('live', 'clerk.example.com'));

        expect(status).not.toBe(0);
        expect(stderr).toContain('clerk.example.com');
    });
});
