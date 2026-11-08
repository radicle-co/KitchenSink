/**
 * NATIVE-SOURCE DISCOVERY: every app module that renders on a phone, for the guards that read native code only. A
 * guard that silently stops reading a file passes vacuously forever (`appSources.ts`), and the native guards had each
 * grown their own glob. `nativeStylingRatchet`, `nativeFaceWeight` and the Tamagui guards read through this. ⚠️ Still
 * owed: the guards fed by `reactNativeValueUses.appSourceFiles` (a glob over every app source, native or not) move here
 * once each is checked against this narrower set.
 *
 * A module is native when it is a `.native.ts(x)` leaf anywhere in the apps, when it belongs to the mobile app (its
 * `src/` and its root `App.tsx`), or when it imports a value from `react-native` (a shared module with no web sibling).
 * Exclusions are `appSourceModules`' own: tests, fixtures and build output.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { appSourceModules, parseModule } from './appSources.js';
import { isReactNative, valueBindingsOf } from './moduleBindings.js';
import { repoRoot } from './serviceSources.js';

const MOBILE_APP = /^packages\/apps\/commise\/mobile\/(?:src\/|App\.tsx$)/u;

/**
 * The native app modules.
 *
 * @returns Repo-relative paths, sorted.
 * @sideEffect Shells out to git and reads the working tree.
 */
export function nativeSources(): readonly string[] {
    return appSourceModules().filter(
        (file) =>
            /\.native\.tsx?$/u.test(file) ||
            MOBILE_APP.test(file) ||
            valueBindingsOf(parseModule(file, readFileSync(path.join(repoRoot, file), 'utf8')), isReactNative).imported,
    );
}
