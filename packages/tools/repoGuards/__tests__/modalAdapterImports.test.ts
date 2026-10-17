/**
 * Every modal window in the apps opens through `@commise/ui/modal` — asserted by DISCOVERY, never by a list.
 *
 * ⛔ WHY THIS GUARD EXISTS. React Native's `Modal` opens its own window, and on iOS that window supports portrait only
 * unless `supportedOrientations` says otherwise. The app follows the device's orientation (WCAG 2.2 SC 1.3.4), so a
 * raw `Modal` turns a landscape screen back to portrait the moment it opens. Eight hand-built modals in three packages
 * made that mistake together, because nothing but the prop's absence showed it, and an absence passes every test.
 * `@commise/ui/modal` fixes the prop once; this guard keeps the next modal from bypassing it.
 *
 * ⛔ IT ENUMERATES NOTHING. Candidate files come from the FILESYSTEM (every app source file, the working tree rather
 * than the git index), and each is read with the TypeScript parser (`reactNativeValueUses.ts`, whose own table covers
 * the shapes), so a renamed import (`Modal as RNModal`) or a namespace member (`RN.Modal`) is caught and a type-only
 * import, which opens no window, is not.
 *
 * ✅ THE FIX FOR A FAILURE: import `Modal` from `@commise/ui/modal` instead. Its props are React Native's, less the
 * orientation lock.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { appSourceFiles, reactNativeValueUses } from './reactNativeValueUses.js';
import { repoRoot } from './serviceSources.js';

/** The adapter itself, the one module that may open React Native's `Modal` directly. */
const ADAPTER = 'packages/apps/commise/ui/src/modal/Modal.native.tsx';

/** How a source file reaches React Native's `Modal` as a value (the detector is `reactNativeValueUses.ts`). */
const rawModalUses = (source: string, fileName: string): readonly string[] =>
    reactNativeValueUses(source, fileName, 'Modal');

describe('the apps open modal windows only through @commise/ui/modal', () => {
    it('discovers the app sources, including the adapter (a vacuous pass would hide every rule below)', () => {
        const files = appSourceFiles();

        expect(files.length).toBeGreaterThan(100);
        expect(files).toContain(ADAPTER);
    });

    it('finds React Native’s Modal in the adapter, so the detector reads the real file', () => {
        expect(rawModalUses(readFileSync(path.join(repoRoot, ADAPTER), 'utf8'), ADAPTER)).not.toHaveLength(0);
    });

    it('finds it nowhere else', () => {
        const offenders = appSourceFiles()
            .filter((file) => file !== ADAPTER)
            .flatMap((file) =>
                rawModalUses(readFileSync(path.join(repoRoot, file), 'utf8'), file).map((use) => `${file}: ${use}`),
            );

        expect(offenders).toEqual([]);
    });
});
