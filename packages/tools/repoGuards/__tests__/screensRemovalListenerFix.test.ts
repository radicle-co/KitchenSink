// @vitest-environment node
/**
 * The mobile app runs a react-native-screens release that carries the fix for the launch crash in
 * `MountingCoordinator::pullTransaction`, and Expo's dependency check cannot quietly take it back.
 *
 * ⛔ WHY THIS GUARD EXISTS. Up to 4.27.x, react-native-screens builds its `RNSScreenRemovalListener` lazily in
 * `NativeProxy::nativeAddMutationsListener`, behind an unlocked `if (!screenRemovalListener_)`. On a cold launch two
 * threads run that function at once: `ScreensModule.initialize()` on the JS thread, and the `onHostResume()` that
 * `addLifecycleEventListener` posts to the UI thread when the host is already resumed. Both can pass the check, and the
 * two `shared_ptr` writes race. The member can end up with one thread's object and the other thread's control block, so
 * the listener registered on the mounting coordinator is freed while its `weak_ptr` still locks. The next
 * `pullTransaction` calls `shouldOverridePullTransaction()` through the freed object's vtable: SIGSEGV on `mqt_v_js`,
 * `SEGV_ACCERR` into `[anon:scudo:primary]` or `SEGV_MAPERR` at 0x0. The Android Maestro run of 2026-10-30 lost
 * `publishFeedback` and `ingredientAddDetails` to it. Fixed upstream in software-mansion/react-native-screens#4413,
 * first released in 4.28.0.
 *
 * ⛔ WHY THE EXCLUSION. Expo SDK 57 still pins `react-native-screens ~4.26.0`, so `npx expo install --fix` would move
 * the app back to the crashing release. `expo.install.exclude` stops that. The exclusion is wanted only while Expo's own
 * pin is older than the fix: this guard fails when Expo catches up, so the exclusion does not outlive its reason.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import semver from 'semver';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './roleSplitSources.js';

/** The first react-native-screens release that carries software-mansion/react-native-screens#4413. */
const FIRST_FIXED = '4.28.0';

const SCREENS = 'react-native-screens';
const MOBILE_MANIFEST = path.join(REPO_ROOT, 'packages/apps/commise/mobile/package.json');

/** The parts of a `package.json` this guard reads. */
interface Manifest {
    readonly version?: string;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly expo?: { readonly install?: { readonly exclude?: readonly string[] } };
}

/**
 * Reads a JSON file.
 *
 * @sideEffect Reads the file system.
 * @param file - Absolute path.
 * @returns The parsed document.
 */
function readJson<T>(file: string): T {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/** Resolves a package's own `package.json` the way the mobile app's bundler and Gradle do: from the mobile package. */
const resolveFromMobile = createRequire(MOBILE_MANIFEST).resolve;

/**
 * Whether a declared range can only resolve to a release that carries the fix.
 *
 * @param range - A semver range, as written in a manifest.
 * @returns `true` when the lowest version the range admits is the first fixed release or later.
 */
function rangeExcludesUnfixed(range: string): boolean {
    const lowest = semver.minVersion(range);

    return lowest !== null && semver.gte(lowest, FIRST_FIXED);
}

describe('react-native-screens carries the launch-crash fix (#4413)', () => {
    const mobile = readJson<Manifest>(MOBILE_MANIFEST);
    const declared = mobile.dependencies?.[SCREENS] ?? '';

    it('declares a range that cannot resolve to a release without the fix', () => {
        expect(declared).not.toBe('');
        expect(rangeExcludesUnfixed(declared)).toBe(true);
    });

    it('resolves an installed release that carries the fix', () => {
        const installed = readJson<Manifest>(resolveFromMobile(`${SCREENS}/package.json`)).version ?? '0.0.0';
        expect(semver.gte(installed, FIRST_FIXED)).toBe(true);
    });

    it('excludes the package from Expo dependency validation exactly while Expo pins a release without the fix', () => {
        const bundled = readJson<Readonly<Record<string, string>>>(resolveFromMobile('expo/bundledNativeModules.json'));
        const expoPin = bundled[SCREENS] ?? '';
        const excluded = mobile.expo?.install?.exclude?.includes(SCREENS) ?? false;

        expect(expoPin).not.toBe('');
        expect(excluded).toBe(!rangeExcludesUnfixed(expoPin));
    });
});

describe('rangeExcludesUnfixed', () => {
    it.each([
        ['~4.26.0', false],
        ['^4.26.2', false],
        ['~4.27.0', false],
        ['~4.28.0', true],
        ['^4.28.0', true],
        ['4.30.1', true],
        ['>=4.27.0', false],
    ])('%s -> %s', (range, expected) => {
        expect(rangeExcludesUnfixed(range)).toBe(expected);
    });
});
