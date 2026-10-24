/**
 * The runtime half of plan 012 D1a: what the app reads back out of `Constants.expoConfig.extra`, and which providers
 * that allows on which platform. The boundary is a parse (Anti-Corruption Layer): `extra` is whatever the build wrote,
 * so anything that is not a complete, self-consistent config is the all-off Null Object — a provider is never shown
 * without the client ids its hook needs.
 */
import { describe, expect, it } from 'vitest';

import { readSocialAuthConfig, SOCIAL_AUTH_OFF, socialProvidersFor } from '../../src/auth/socialAuthConfig.js';

const WEB = '1-web.apps.googleusercontent.com';
const IOS = '1-ios.apps.googleusercontent.com';

const fullExtra = {
    EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID: WEB,
    EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID: IOS,
    EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME: 'com.googleusercontent.apps.1-ios',
    socialAuth: { googleIos: true, googleAndroid: true, appleIos: true },
};

describe('readSocialAuthConfig', () => {
    it('reads a complete config as written', () => {
        expect(readSocialAuthConfig(fullExtra)).toEqual({ googleIos: true, googleAndroid: true, appleIos: true });
    });

    it.each<[string, unknown]>([
        ['no extra at all', undefined],
        ['a null extra', null],
        ['an extra with no socialAuth', { other: 1 }],
        ['a socialAuth missing a flag', { ...fullExtra, socialAuth: { googleIos: true, appleIos: true } }],
        ['a flag that is not a boolean', { ...fullExtra, socialAuth: { ...fullExtra.socialAuth, appleIos: 'yes' } }],
    ])('is all-off for %s', (_name, extra) => {
        expect(readSocialAuthConfig(extra)).toEqual(SOCIAL_AUTH_OFF);
    });

    it('turns Google OFF on both platforms when the web client the hook needs is absent', () => {
        const { EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID: _web, ...withoutWeb } = fullExtra;

        expect(readSocialAuthConfig(withoutWeb)).toEqual({ googleIos: false, googleAndroid: false, appleIos: true });
    });

    it('turns Google OFF on iOS only when the iOS client is absent (Android uses the web client)', () => {
        const { EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID: _ios, ...withoutIos } = fullExtra;

        expect(readSocialAuthConfig(withoutIos)).toEqual({ googleIos: false, googleAndroid: true, appleIos: true });
    });

    it('turns Google OFF on iOS when the URL scheme is absent: the plugin wrote no scheme, so the SDK would fail on tap', () => {
        const { EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME: _scheme, ...withoutScheme } = fullExtra;

        expect(readSocialAuthConfig(withoutScheme).googleIos).toBe(false);
    });
});

describe('socialProvidersFor', () => {
    it('offers Apple then Google on iOS', () => {
        expect(socialProvidersFor({ googleIos: true, googleAndroid: true, appleIos: true }, 'ios')).toEqual([
            'apple',
            'google',
        ]);
    });

    it('offers Apple alone on iOS when Google is off', () => {
        expect(socialProvidersFor({ googleIos: false, googleAndroid: true, appleIos: true }, 'ios')).toEqual(['apple']);
    });

    it('⛔ never offers Google on iOS WITHOUT Apple (App Store Review Guideline 4.8)', () => {
        expect(socialProvidersFor({ googleIos: true, googleAndroid: true, appleIos: false }, 'ios')).toEqual([]);
    });

    it('offers Google alone on Android, and never Apple there (the Apple hook is iOS-only)', () => {
        expect(socialProvidersFor({ googleIos: true, googleAndroid: true, appleIos: true }, 'android')).toEqual([
            'google',
        ]);
    });

    it('offers nothing on Android when its Google client is not registered (prod, D3)', () => {
        expect(socialProvidersFor({ googleIos: true, googleAndroid: false, appleIos: true }, 'android')).toEqual([]);
    });

    it.each(['web', 'windows', 'macos'])('offers nothing on %s, where no native provider hook exists', (os) => {
        expect(socialProvidersFor({ googleIos: true, googleAndroid: true, appleIos: true }, os)).toEqual([]);
    });
});
