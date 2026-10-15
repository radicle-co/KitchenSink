/**
 * The Expo app config (`app.config.ts`, plan 012 D1/D2) — the ONE place a build learns its native identity, its config
 * plugins and, per Clerk instance, its Google / Apple sign-in clients.
 *
 * These assertions guard entries whose absence fails SILENTLY at prebuild rather than at type-check or test time:
 *
 * - `@clerk/expo` v4 ships an `app.plugin.js` that adds clerk-android's `META-INF` packaging exclusion and the Kotlin
 *   metadata flag. Without it every Vitest suite still passes and only the Android Gradle build breaks, in CI.
 * - `@clerk/expo-google-signin`'s plugin writes the iOS Google URL scheme, and silently does NOTHING when the scheme is
 *   absent — the Google SDK then fails on tap.
 * - ⚠️ `appleSignIn` used to be pinned `false` here, on the premise that the app "ships a custom email/password form
 *   with no Apple/Google SSO path". Plan 012 removes that premise: Sign in with Apple is built (App Store Review
 *   Guideline 4.8 requires it beside Google on iOS), so the entitlement is now REQUIRED and the test is inverted — a build
 *   that still carries `appleSignIn: false` must fail here rather than at App Review.
 *
 * What the plugins then WRITE (Info.plist scheme, entitlement) is proved by `expo config --type introspect` in the
 * integration tier (`tests/__integration__/appConfigIntrospect.integration.test.ts`), because a Vitest import resolves
 * modules differently from Expo's own config loader.
 */
import { describe, expect, it } from 'vitest';

import { buildAppConfig, SOCIAL_AUTH_BY_CLERK_INSTANCE } from '../app.config.js';

/** A publishable key for a Clerk frontend-API host, built the way Clerk encodes one (`pk_<type>_` + base64(host + '$')). */
function publishableKey(type: 'test' | 'live', host: string): string {
    return `pk_${type}_${Buffer.from(`${host}$`).toString('base64')}`;
}

const SANDBOX_KEY = publishableKey('test', 'nice-fowl-6.clerk.accounts.dev');
const PROD_KEY = publishableKey('live', 'clerk.commise.app');

const configFor = (key: string | undefined, extraEnv: Record<string, string> = {}) =>
    buildAppConfig({ EXPO_PUBLIC_IDP_PUBLISHABLE_KEY: key, ...extraEnv });

/** A plugin entry is either a bare module name or a `[name, props]` tuple. */
type PluginEntry = string | readonly [string, Record<string, unknown>];

function findPlugin(moduleName: string): PluginEntry | undefined {
    const plugins = (configFor(SANDBOX_KEY).plugins ?? []) as readonly PluginEntry[];

    return plugins.find((entry) => (typeof entry === 'string' ? entry === moduleName : entry[0] === moduleName));
}

/**
 * The app follows the device's orientation (WCAG 2.2 SC 1.3.4 Orientation; Android 16 ignores an orientation lock on
 * large screens anyway, so a lock only made phones and tablets disagree).
 *
 * ⚠️ `'default'` is required, not merely "not portrait". Expo's Android `withOrientation` leaves the manifest
 * untouched when the key is ABSENT, so a prebuilt `android/` tree keeps whatever lock it was generated with. Only
 * `'default'` writes `android:screenOrientation="unspecified"`; on iOS it lists all four interface orientations.
 */
describe('app config orientation', () => {
    it('follows the device orientation instead of locking one', () => {
        expect(configFor(SANDBOX_KEY).orientation).toBe('default');
    });

    it('does not restate the iOS orientations in infoPlist, which would override the setting above', () => {
        const infoPlist = Object.keys(configFor(SANDBOX_KEY).ios?.infoPlist ?? {});

        expect(infoPlist).not.toContain('UISupportedInterfaceOrientations');
        expect(infoPlist).not.toContain('UISupportedInterfaceOrientations~ipad');
    });
});

describe('app config identity', () => {
    it('is one app for every stage: io.commise.mobile on both platforms (owner, 2026-10-13)', () => {
        for (const key of [SANDBOX_KEY, PROD_KEY]) {
            const config = configFor(key);

            expect(config.ios?.bundleIdentifier).toBe('io.commise.mobile');
            expect(config.android?.package).toBe('io.commise.mobile');
        }
    });

    it('lets the system Sign in with Apple button follow the device language (CFBundleAllowMixedLocalizations)', () => {
        expect(configFor(SANDBOX_KEY).ios?.infoPlist?.['CFBundleAllowMixedLocalizations']).toBe(true);
    });
});

describe('app config plugins', () => {
    it('registers @clerk/expo with props, and turns the Sign in with Apple entitlement ON', () => {
        const entry = findPlugin('@clerk/expo');

        expect(Array.isArray(entry)).toBe(true);
        expect(Array.isArray(entry) ? entry[1] : undefined).toMatchObject({ appleSignIn: true });
    });

    it('registers the native Google sign-in plugin that writes the iOS URL scheme', () => {
        expect(findPlugin('@clerk/expo-google-signin')).toBeDefined();
    });

    it('does not ALSO register expo-apple-authentication’s plugin, which would write the same entitlement twice', () => {
        expect(findPlugin('expo-apple-authentication')).toBeUndefined();
    });
});

/**
 * The recipe photo uploader's "Take photo" (A-010, UI walk 2026-10-13) needs the camera and the photo library, and
 * nothing else. `expo-image-picker`'s plugin writes a microphone usage string on iOS and keeps `RECORD_AUDIO` on Android
 * unless `microphonePermission` is `false`; the app records no video, so asking for the microphone is a permission the
 * app does not use (least privilege, and an App Review question for nothing). A native build is needed for any of it.
 */
describe('app config expo-image-picker', () => {
    const entry = findPlugin('expo-image-picker');
    const props = Array.isArray(entry) ? (entry[1] as Record<string, unknown>) : {};

    it('is registered with props (not as a bare string), so its usage strings are ours', () => {
        expect(Array.isArray(entry)).toBe(true);
    });

    it('explains the photo library and the camera in plain words', () => {
        expect(props['photosPermission']).toEqual(expect.stringMatching(/photos/iu));
        expect(props['cameraPermission']).toEqual(expect.stringMatching(/camera/iu));
    });

    it('asks for no microphone: the app takes pictures, not video', () => {
        expect(props['microphonePermission']).toBe(false);
    });
});

/**
 * D1 — the Clerk instance the publishable key names selects the Google clients. That is the real invariant: Clerk
 * verifies the Google ID token against the web client in ITS OWN custom credentials, so a build pairing one instance's
 * key with another's clients signs nobody in.
 */
describe('social sign-in config per Clerk instance', () => {
    it('gives the sandbox build the sandbox Google clients, the derived iOS URL scheme, and every provider', () => {
        const { extra } = configFor(SANDBOX_KEY);

        expect(extra).toEqual({
            EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID:
                '191572900034-br586l3hrkje8c6499tpnkf0h0duuqtc.apps.googleusercontent.com',
            EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID:
                '191572900034-7umbfpo56atk161tpu88jup50ma0pscg.apps.googleusercontent.com',
            EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME:
                'com.googleusercontent.apps.191572900034-7umbfpo56atk161tpu88jup50ma0pscg',
            EXPO_PUBLIC_CLERK_GOOGLE_ANDROID_CLIENT_ID:
                '191572900034-entaq2q4ofkgm333h3dks156kbph3cef.apps.googleusercontent.com',
            socialAuth: { googleIos: true, googleAndroid: true, appleIos: true },
        });
    });

    it('gives the prod build the prod clients and NO Android Google (no release signing key yet, D3)', () => {
        const { extra } = configFor(PROD_KEY);

        expect(extra).toEqual({
            EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID:
                '686681118292-l1g5nhd9akk3f490f11ikepanb6ikvfj.apps.googleusercontent.com',
            EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID:
                '686681118292-325832urtk1g3077qv5mcdrv8q7sji80.apps.googleusercontent.com',
            EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME:
                'com.googleusercontent.apps.686681118292-325832urtk1g3077qv5mcdrv8q7sji80',
            socialAuth: { googleIos: true, googleAndroid: false, appleIos: true },
        });
    });

    it('never pairs one Google project with another: each row’s web and iOS clients share a project number', () => {
        for (const [host, row] of Object.entries(SOCIAL_AUTH_BY_CLERK_INSTANCE)) {
            const project = (clientId: string) => clientId.split('-')[0];
            const clients = [row.google.webClientId, row.google.iosClientId, row.google.androidClientId].filter(
                (clientId): clientId is string => clientId !== null,
            );

            expect(new Set(clients.map(project)).size, host).toBe(1);
        }
    });

    it.each<[string, string | undefined]>([
        ['an absent key (a local run with no .env.local)', undefined],
        ['a blank key', ''],
        ['an unparseable key', 'not-a-key'],
        [
            'a development key for an instance the table does not know',
            publishableKey('test', 'other.clerk.accounts.dev'),
        ],
    ])('turns every provider OFF for %s — fail closed, and no Google client is written', (_name, key) => {
        expect(configFor(key).extra).toEqual({
            socialAuth: { googleIos: false, googleAndroid: false, appleIos: false },
        });
    });

    it('REFUSES a production key for an instance the table does not know: a prod build never quietly loses sign-in', () => {
        expect(() => configFor(publishableKey('live', 'clerk.example.com'))).toThrow(/clerk\.example\.com/u);
    });

    it('REFUSES a key whose instance type disagrees with the row (a pk_test for the prod host)', () => {
        expect(() => configFor(publishableKey('test', 'clerk.commise.app'))).toThrow(/production/u);
    });

    it.each([
        'EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID',
        'EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID',
        'EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME',
        'EXPO_PUBLIC_CLERK_GOOGLE_ANDROID_CLIENT_ID',
    ])('REFUSES %s in the environment: the plugin reads env first, the hook reads extra first', (name) => {
        expect(() => configFor(SANDBOX_KEY, { [name]: 'x.apps.googleusercontent.com' })).toThrow(name);
    });
});
