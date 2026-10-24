/**
 * The Expo app config — the ONE authority for what a build of the mobile app is: its native identity, its config
 * plugins, and (plan 012 D1) the Google / Apple sign-in clients of the Clerk instance it signs in against.
 *
 * ## Why the Clerk instance selects the clients
 *
 * The stage already reaches a build through exactly one value: the Clerk publishable key (`load-secrets` in CI,
 * `scripts/fetchSecrets.mjs` locally, both keyed on the stage). The key encodes its instance's frontend-API host, and
 * that host is the real invariant — Clerk verifies a Google ID token against the web client in ITS OWN custom
 * credentials, so a build pairing one instance's key with another's clients signs nobody in. Keying the table on the
 * host makes that pairing unrepresentable, adds no environment variable (the content key already hashes the publishable
 * key by value, and moves with this file through `$TURBO_DEFAULT$`), and needs no `EXPO_PUBLIC_STAGE`, which the CI test
 * app, the `e2e` profile and local development do not set.
 *
 * ## Why the table lives HERE
 *
 * Only prebuild needs it — the iOS Google URL scheme must be in the Info.plist, and one bundle ID with two iOS clients
 * means it differs per build — and Expo's config loader cannot import a value module from `src/` (plan 012 fact 13).
 * The runtime reads back only what this file writes into `extra` (`src/auth/socialAuthConfig.ts`).
 *
 * ## The refusals, and why each fails LOUDLY
 *
 * - A production key for an instance the table does not know: a prod build must never quietly ship without sign-in.
 * - A key whose instance type disagrees with its row: the table or the key is wrong, and guessing which is worse.
 * - Any `EXPO_PUBLIC_CLERK_GOOGLE_*` in the environment: the plugin reads the environment BEFORE `extra` and the hook
 *   reads `extra` BEFORE the environment, so a stray variable would make the Info.plist and the runtime disagree.
 *
 * An unknown or absent DEVELOPMENT key (a developer's own instance, or no `.env.local` yet) turns every provider off.
 *
 * @pattern Registry — {@link SOCIAL_AUTH_BY_CLERK_INSTANCE}, one row per Clerk instance.
 * @pattern Factory — {@link buildAppConfig}, pure over the environment it is given.
 */
import { parsePublishableKey } from '@clerk/shared/keys';
import type { ExpoConfig } from 'expo/config';

import type { SocialAuthExtra } from './src/auth/socialAuthConfig.js';

/**
 * The iOS bundle ID: the App ID registered in the Apple Developer account (Team `6822556035`), and the one both Clerk
 * instances' Native applications list (`6822556035.com.radicle-co.commise`). Owner ruling 2026-10-16.
 * `.maestro` flows and `runMaestroFlows.sh` take it from here by `maestroAppId.test.ts`, which reads this declaration.
 */
export const IOS_BUNDLE_IDENTIFIER = 'com.radicle-co.commise';

/** The Android application ID: the package Clerk's Android Native application lists. Deliberately NOT the iOS bundle. */
export const ANDROID_PACKAGE = 'io.commise.mobile';

/** A Clerk instance's Google OAuth clients (public identifiers, not secrets). */
interface GoogleClients {
    /** The web client in this Clerk instance's Google custom credentials — the ID token's audience. */
    readonly webClientId: string;
    /** The iOS client; its reversed form is the Info.plist URL scheme. */
    readonly iosClientId: string;
    /**
     * The Android client, or `null` while none is REGISTERED for the signing certificate the build is signed with. The
     * app never sends it (Credential Manager uses the web client), so this field is the explicit "Android Google works"
     * marker: Google refuses the call without a registered client (plan 012 D3).
     */
    readonly androidClientId: string | null;
}

/** One Clerk instance's native social sign-in. */
interface InstanceSocialAuth {
    /** The instance type its publishable key must carry. */
    readonly instanceType: 'development' | 'production';
    readonly google: GoogleClients;
    /** Sign in with Apple on iOS (App ID {@link IOS_BUNDLE_IDENTIFIER}, Team `6822556035`). */
    readonly appleIos: boolean;
}

/** Every Clerk instance a build may sign in against, keyed by its frontend-API host. */
export const SOCIAL_AUTH_BY_CLERK_INSTANCE: Readonly<Record<string, InstanceSocialAuth>> = {
    // Sandbox (the dev instance every preview signs in against). Android client: the CI test app's debug keystore.
    'nice-fowl-6.clerk.accounts.dev': {
        instanceType: 'development',
        google: {
            webClientId: '191572900034-br586l3hrkje8c6499tpnkf0h0duuqtc.apps.googleusercontent.com',
            iosClientId: '191572900034-7umbfpo56atk161tpu88jup50ma0pscg.apps.googleusercontent.com',
            androidClientId: '191572900034-entaq2q4ofkgm333h3dks156kbph3cef.apps.googleusercontent.com',
        },
        appleIos: true,
    },
    // Production. No Android client until the first release build's signing key exists (owner, 2026-10-13).
    'clerk.commise.app': {
        instanceType: 'production',
        google: {
            webClientId: '686681118292-l1g5nhd9akk3f490f11ikepanb6ikvfj.apps.googleusercontent.com',
            iosClientId: '686681118292-325832urtk1g3077qv5mcdrv8q7sji80.apps.googleusercontent.com',
            androidClientId: null,
        },
        appleIos: true,
    },
};

/** The `extra` of a build with no social sign-in. */
const NO_SOCIAL_AUTH: SocialAuthExtra = { socialAuth: { googleIos: false, googleAndroid: false, appleIos: false } };

/** Google's iOS URL scheme is the iOS client id reversed: `com.googleusercontent.apps.<prefix>`. Pure. */
function iosUrlSchemeOf(iosClientId: string): string {
    return `com.googleusercontent.apps.${iosClientId.replace(/\.apps\.googleusercontent\.com$/u, '')}`;
}

/**
 * Resolve the `extra` a build carries for its publishable key.
 *
 * @throws {Error} For an unknown production instance, or a key whose instance type disagrees with its row.
 */
function socialAuthExtraFor(publishableKey: string | undefined): SocialAuthExtra {
    const parsed = parsePublishableKey(publishableKey);

    if (parsed === null) {
        return NO_SOCIAL_AUTH;
    }

    const row = SOCIAL_AUTH_BY_CLERK_INSTANCE[parsed.frontendApi];

    if (row === undefined) {
        if (parsed.instanceType === 'production') {
            throw new Error(
                `app.config.ts: the production Clerk instance '${parsed.frontendApi}' has no row in ` +
                    'SOCIAL_AUTH_BY_CLERK_INSTANCE — refusing to build a production app without its sign-in clients.',
            );
        }

        return NO_SOCIAL_AUTH;
    }

    if (row.instanceType !== parsed.instanceType) {
        throw new Error(
            `app.config.ts: the publishable key is a ${parsed.instanceType} key, but '${parsed.frontendApi}' is ` +
                `recorded as a ${row.instanceType} instance — refusing to guess which is wrong.`,
        );
    }

    const { webClientId, iosClientId, androidClientId } = row.google;

    return {
        EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID: webClientId,
        EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID: iosClientId,
        EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME: iosUrlSchemeOf(iosClientId),
        ...(androidClientId === null ? {} : { EXPO_PUBLIC_CLERK_GOOGLE_ANDROID_CLIENT_ID: androidClientId }),
        socialAuth: { googleIos: true, googleAndroid: androidClientId !== null, appleIos: row.appleIos },
    };
}

/**
 * The iOS `webcredentials:` associated domain for the build's Clerk instance. Apple applies the instance's
 * `apple-app-site-association` file to the app only when the app lists the host, so each build lists its OWN instance
 * (the sandbox and production hosts differ, as do their Native applications). Pure.
 */
function associatedDomainsFor(publishableKey: string | undefined): { associatedDomains?: string[] } {
    const parsed = parsePublishableKey(publishableKey);

    return parsed === null ? {} : { associatedDomains: [`webcredentials:${parsed.frontendApi}`] };
}

/**
 * The whole app config for an environment.
 *
 * @param env - The build environment (`process.env` at prebuild / build time).
 * @returns The Expo config. Pure.
 * @throws {Error} For a stray `EXPO_PUBLIC_CLERK_GOOGLE_*` variable, or a publishable key {@link socialAuthExtraFor}
 *     refuses.
 */
export function buildAppConfig(env: Readonly<Record<string, string | undefined>>): ExpoConfig {
    const stray = Object.keys(env).filter((name) => name.startsWith('EXPO_PUBLIC_CLERK_GOOGLE_'));

    if (stray.length > 0) {
        throw new Error(
            `app.config.ts: ${stray.join(', ')} must not be set — the Google clients come from ` +
                'SOCIAL_AUTH_BY_CLERK_INSTANCE, and a variable would make the Info.plist and the runtime disagree.',
        );
    }

    return {
        name: 'Commise',
        slug: 'commise-mobile',
        version: '1.0.0',
        orientation: 'default',
        icon: './src/assets/icon.png',
        scheme: 'commise',
        userInterfaceStyle: 'automatic',
        ios: {
            supportsTablet: true,
            bundleIdentifier: IOS_BUNDLE_IDENTIFIER,
            ...associatedDomainsFor(env['EXPO_PUBLIC_IDP_PUBLISHABLE_KEY']),
            infoPlist: {
                CFBundleURLTypes: [{ CFBundleURLSchemes: ['commise', IOS_BUNDLE_IDENTIFIER] }],
                // The system Sign in with Apple button localises itself only when the app allows mixed localisations
                // (what `expo-apple-authentication`'s plugin would set; its entitlement half is `@clerk/expo`'s below).
                CFBundleAllowMixedLocalizations: true,
            },
        },
        android: {
            package: ANDROID_PACKAGE,
            adaptiveIcon: {
                foregroundImage: './src/assets/adaptiveIcon.png',
                backgroundColor: '#ffffff',
            },
        },
        web: {
            bundler: 'metro',
            favicon: './src/assets/favicon.png',
        },
        plugins: [
            [
                '@sentry/react-native/expo',
                {
                    organization: 'radicle-co',
                    project: 'commise-mobile',
                    url: 'https://sentry.io/',
                },
            ],
            'expo-image',
            [
                'expo-image-picker',
                {
                    photosPermission: 'Commise uses your photos so you can add pictures to your recipes.',
                    cameraPermission: 'Commise uses your camera so you can take a picture for your recipe.',
                    microphonePermission: false,
                },
            ],
            // `appleSignIn: true` writes the `com.apple.developer.applesignin` entitlement (Guideline 4.8, plan 012 D2).
            ['@clerk/expo', { appleSignIn: true }],
            // Writes `extra.EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME` into the Info.plist; silently nothing without one.
            '@clerk/expo-google-signin',
        ],
        extra: { ...socialAuthExtraFor(env['EXPO_PUBLIC_IDP_PUBLISHABLE_KEY']) },
    };
}

export default (): ExpoConfig => buildAppConfig(process.env);
