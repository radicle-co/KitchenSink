/**
 * Guards that EVERY `Intl` constructor the app's shared formatters use is polyfilled for Hermes in `App.tsx`.
 *
 * Hermes (React Native's engine) ships only a SUBSET of `Intl`: on Android its platform-ICU binding provides
 * `Collator`, `DateTimeFormat` and `NumberFormat` and nothing else. Every other `Intl` constructor is
 * `undefined`, so `new Intl.Whatever(...)` throws `TypeError: undefined cannot be used as a constructor` — at
 * RUNTIME, on device only. Web has the full set, so the shared `features/*` formatters type-check, unit-test
 * and render perfectly on web while crashing the native screen that calls them.
 *
 * This is not hypothetical. `formatRelativeTime` (`features/recipes/src/card/model.ts`) calls
 * `new Intl.RelativeTimeFormat`, which was NOT polyfilled — so `CardBadges` crashed the whole
 * Collection-detail screen into the root error boundary for any recipe card older than 60 seconds (a card
 * younger than that takes the `justNow` early return and never touches `Intl`, which is exactly why the bug
 * hid: the CI seed data is fresh). `Intl.PluralRules` was polyfilled; its sibling was simply missed.
 *
 * A unit test cannot catch this by EXECUTING the formatters — Node has a complete `Intl`, so they pass. The
 * only check that works off-device is a static one: enumerate the `Intl` constructors the shared sources
 * actually construct, and require a matching @formatjs polyfill import in the app entry. Adding a new
 * `new Intl.X(...)` to a shared formatter without polyfilling it fails this test instead of the device.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `Intl` constructors Hermes provides natively (Android platform ICU) — these need no polyfill. Everything
 * else `Intl` exposes on web is absent and MUST be polyfilled before first use.
 */
const HERMES_NATIVE_INTL: readonly string[] = ['Collator', 'DateTimeFormat', 'NumberFormat'];

/** Source trees whose modules run inside the mobile app and may construct `Intl` formatters. */
const SCANNED_SOURCE_ROOTS: readonly string[] = [
    join(import.meta.dirname, '..', 'src'),
    join(import.meta.dirname, '..', '..', 'features', 'recipes', 'src'),
    join(import.meta.dirname, '..', '..', 'features', 'core', 'src'),
];

const SOURCE_EXTENSIONS: readonly string[] = ['.ts', '.tsx'];

/** Directory names that hold test-only code (their `Intl` use never ships to a device). */
const EXCLUDED_DIRS: readonly string[] = ['__tests__', '__fixtures__', '__integration__', 'node_modules'];

/**
 * Every source file under `root`, recursively, excluding test-only directories.
 *
 * @param root - Directory to walk.
 * @returns Absolute paths of the shippable source files found.
 * @sideEffect Reads the filesystem.
 */
function sourceFilesUnder(root: string): readonly string[] {
    const found: string[] = [];

    for (const entry of readdirSync(root)) {
        const path = join(root, entry);

        if (statSync(path).isDirectory()) {
            if (!EXCLUDED_DIRS.includes(entry)) {
                found.push(...sourceFilesUnder(path));
            }

            continue;
        }

        if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension)) && !entry.includes('.test.')) {
            found.push(path);
        }
    }

    return found;
}

/**
 * The distinct `Intl` constructor names that `new Intl.X(...)` is called on across the scanned sources.
 *
 * @returns The constructor names, sorted.
 * @sideEffect Reads the filesystem.
 */
function constructedIntlApis(): readonly string[] {
    const names = new Set<string>();

    for (const root of SCANNED_SOURCE_ROOTS) {
        for (const file of sourceFilesUnder(root)) {
            for (const match of readFileSync(file, 'utf8').matchAll(/new Intl\.([A-Za-z]+)\s*\(/g)) {
                const name = match[1];

                if (name !== undefined) {
                    names.add(name);
                }
            }
        }
    }

    return [...names].sort();
}

const appEntrySource = readFileSync(join(import.meta.dirname, '..', 'App.tsx'), 'utf8');

describe('Hermes Intl polyfill coverage', () => {
    it('constructs at least one non-native Intl API (otherwise this guard proves nothing)', () => {
        const requiringPolyfill = constructedIntlApis().filter((name) => !HERMES_NATIVE_INTL.includes(name));

        expect(requiringPolyfill.length).toBeGreaterThan(0);
    });

    it('polyfills every Intl constructor the shared formatters use that Hermes lacks', () => {
        const missing = constructedIntlApis()
            .filter((name) => !HERMES_NATIVE_INTL.includes(name))
            .filter((name) => !appEntrySource.includes(`@formatjs/intl-${name.toLowerCase()}/polyfill`));

        expect(missing).toEqual([]);
    });

    it('loads `en` locale data for every polyfilled Intl constructor', () => {
        // A @formatjs polyfill installs the constructor but throws/falls back without locale data loaded, so
        // the `/polyfill` import alone is not enough.
        const missingLocaleData = constructedIntlApis()
            .filter((name) => !HERMES_NATIVE_INTL.includes(name))
            .filter((name) => !appEntrySource.includes(`@formatjs/intl-${name.toLowerCase()}/locale-data/en`));

        expect(missingLocaleData).toEqual([]);
    });

    it('declares an ambient module for each polyfill side-effect import (they ship no types)', () => {
        const declarations = readFileSync(join(import.meta.dirname, '..', 'src', 'polyfills.d.ts'), 'utf8');

        const undeclared = [...appEntrySource.matchAll(/from '(@formatjs\/[^']+)'|import '(@formatjs\/[^']+)'/g)]
            .map((match) => match[1] ?? match[2])
            .filter((specifier): specifier is string => specifier !== undefined)
            .filter((specifier) => !declarations.includes(`declare module '${specifier}'`));

        expect(undeclared).toEqual([]);
    });
});
