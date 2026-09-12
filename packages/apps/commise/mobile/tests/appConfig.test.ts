/**
 * Guards the `app.json` Expo config entries whose absence fails SILENTLY at prebuild rather than at
 * type-check or test time — the failure mode that makes them worth pinning in a test.
 *
 * `@clerk/expo` v4 (unlike v2, which was JS-only) ships autolinked native Android/Apple modules AND an
 * `app.plugin.js` config plugin. The plugin is what adds, at `expo prebuild` time, the Android
 * `packaging.resources.excludes` entry that resolves clerk-android's duplicate `META-INF` files and the
 * `-Xskip-metadata-version-check` Kotlin free-compiler-arg. Without the plugin registered here, `tsc` and
 * every Vitest suite still pass — the Android Gradle build is the only thing that breaks, and only in CI.
 *
 * `appleSignIn` is pinned OFF deliberately: the plugin's default (`true`) writes the
 * `com.apple.developer.applesignin` entitlement, and this app ships a custom email/password form with no
 * Apple/Google SSO path (no `useSSO`/`useOAuth`/`expo-apple-authentication` anywhere in `src`). Requesting
 * an entitlement the app does not use requires the matching capability on the Apple Developer account and
 * would fail iOS provisioning for no benefit — least privilege.
 */
import { describe, expect, it } from 'vitest';

import appJson from '../app.json' with { type: 'json' };

/** A plugin entry is either a bare module name or a `[name, props]` tuple. */
type PluginEntry = string | readonly [string, Record<string, unknown>];

const plugins = appJson.expo.plugins as readonly PluginEntry[];

/** Find the `[name, props]` tuple (or bare string) registered for `moduleName`. */
function findPlugin(moduleName: string): PluginEntry | undefined {
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
describe('app.json orientation', () => {
    it('follows the device orientation instead of locking one', () => {
        expect(appJson.expo.orientation).toBe('default');
    });

    it('does not restate the iOS orientations in infoPlist, which would override the setting above', () => {
        expect(Object.keys(appJson.expo.ios.infoPlist)).not.toContain('UISupportedInterfaceOrientations');
        expect(Object.keys(appJson.expo.ios.infoPlist)).not.toContain('UISupportedInterfaceOrientations~ipad');
    });
});

describe('app.json expo plugins', () => {
    it('registers the @clerk/expo config plugin', () => {
        expect(findPlugin('@clerk/expo')).toBeDefined();
    });

    it('registers @clerk/expo with props (not as a bare string) so appleSignIn can be pinned', () => {
        const entry = findPlugin('@clerk/expo');

        expect(Array.isArray(entry)).toBe(true);
    });

    it('disables the Sign in with Apple entitlement the app does not use', () => {
        const entry = findPlugin('@clerk/expo');

        // Narrow to the tuple form; the assertion above already proves it is one.
        const props = Array.isArray(entry) ? entry[1] : undefined;

        expect(props).toMatchObject({ appleSignIn: false });
    });
});
