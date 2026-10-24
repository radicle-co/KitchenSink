/**
 * @module auth/socialAuthConfig — which native sign-in providers this BUILD offers, read back from what `app.config.ts`
 * wrote into `Constants.expoConfig.extra` (plan 012 D1a), and which of them a platform may show (D4).
 *
 * The client-id table itself lives in `app.config.ts`, because only prebuild needs it: the iOS URL scheme must be in the
 * Info.plist, and Expo's config loader cannot import a value module from here. The runtime never sees the table — it
 * reads the build's own answer, so the button shown and the client the hook uses cannot come from two places.
 *
 * @pattern Anti-Corruption Layer — `extra` is parsed, never trusted: anything incomplete is the all-off Null Object, so
 *     a provider is never shown without the client ids its hook would need.
 * @pattern Policy — {@link socialProvidersFor} is the one availability rule.
 *
 * Pure.
 */
import { z } from 'zod';

/** A native sign-in provider. */
export type SocialProvider = 'apple' | 'google';

/** The build's per-platform provider flags (`extra.socialAuth`). */
export interface SocialAuthFlags {
    /** Google on iOS: the instance has an iOS client, and its URL scheme is in the Info.plist. */
    readonly googleIos: boolean;
    /** Google on Android: the instance's Android client is REGISTERED (package + signing certificate, plan 012 D3). */
    readonly googleAndroid: boolean;
    /** Sign in with Apple on iOS. */
    readonly appleIos: boolean;
}

/**
 * The names `@clerk/expo`'s Google hook and `@clerk/expo-google-signin`'s plugin read from `extra`, plus our own flags.
 * `app.config.ts` imports this as a TYPE only (erased), so the shape it writes and the shape read here are one.
 */
export interface SocialAuthExtra {
    readonly EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID?: string;
    readonly EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID?: string;
    readonly EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME?: string;
    readonly EXPO_PUBLIC_CLERK_GOOGLE_ANDROID_CLIENT_ID?: string;
    readonly socialAuth: SocialAuthFlags;
}

/** Every provider off: an unknown instance, a missing key, or an `extra` this build did not write. */
export const SOCIAL_AUTH_OFF: SocialAuthFlags = { googleIos: false, googleAndroid: false, appleIos: false };

const nonEmpty = z.string().min(1);

const extraSchema = z.object({
    EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID: nonEmpty.optional(),
    EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID: nonEmpty.optional(),
    EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME: nonEmpty.optional(),
    socialAuth: z.object({ googleIos: z.boolean(), googleAndroid: z.boolean(), appleIos: z.boolean() }),
});

/**
 * @param extra - `Constants.expoConfig?.extra`, as the build wrote it.
 * @returns The flags, each AND-ed with the presence of what its hook needs (the web client always; on iOS also the iOS
 *     client and the URL scheme the plugin registers). Pure.
 */
export function readSocialAuthConfig(extra: unknown): SocialAuthFlags {
    const parsed = extraSchema.safeParse(extra);

    if (!parsed.success) {
        return SOCIAL_AUTH_OFF;
    }

    const { socialAuth, ...clients } = parsed.data;
    const hasWeb = clients.EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID !== undefined;
    const hasIos =
        clients.EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID !== undefined &&
        clients.EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME !== undefined;

    return {
        googleIos: socialAuth.googleIos && hasWeb && hasIos,
        googleAndroid: socialAuth.googleAndroid && hasWeb,
        appleIos: socialAuth.appleIos,
    };
}

/**
 * The providers a platform shows, in display order.
 *
 * - iOS: Apple, then Google — and Google ONLY beside Apple: App Store Review Guideline 4.8 requires an equivalent to
 *   any third-party login, so a build without Apple shows neither.
 * - Android: Google when its client is registered. Never Apple: `useSignInWithApple` is iOS-only.
 * - Anything else: none (the hooks throw there).
 *
 * @param flags - The build's flags ({@link readSocialAuthConfig}).
 * @param os - `Platform.OS`.
 * @returns The providers, in the order they are drawn. Pure.
 */
export function socialProvidersFor(flags: SocialAuthFlags, os: string): readonly SocialProvider[] {
    if (os === 'ios') {
        if (!flags.appleIos) {
            return [];
        }

        return flags.googleIos ? ['apple', 'google'] : ['apple'];
    }

    if (os === 'android') {
        return flags.googleAndroid ? ['google'] : [];
    }

    return [];
}
