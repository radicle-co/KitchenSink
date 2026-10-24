/**
 * Every text field in the apps renders through `@commise/ui/text-input` — asserted by DISCOVERY, never by a list
 * (`docs/design/compactHeightLayout.md` §7).
 *
 * ⛔ WHY THIS GUARD EXISTS. On a phone held sideways, Android may hand a focused React Native `TextInput` a full-screen
 * editor of its own unless `disableFullscreenUI` is set. That editor hides the field's label, a search's results and
 * every other thing the field means beside. Nothing but the prop's absence shows the defect, and an absence passes
 * every test. `@commise/ui/text-input` fixes the prop once; this guard keeps the next field from bypassing it.
 *
 * ⛔ IT ENUMERATES NOTHING. Candidate files come from the FILESYSTEM, and each is read with the TypeScript parser
 * (`reactNativeValueUses.ts`), so a renamed import or a namespace member is caught, and a type-only import (the type of
 * a ref to the field) is not.
 *
 * ✅ THE FIX FOR A FAILURE: import `TextInput` from `@commise/ui/text-input` instead. Its props are React Native's, less
 * `disableFullscreenUI`. To type a ref, `import type { TextInput } from 'react-native'`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { appSourceFiles, reactNativeValueUses } from './reactNativeValueUses.js';
import { repoRoot } from './serviceSources.js';

/** The adapter itself, the one module that may render React Native's `TextInput` directly. */
const ADAPTER = 'packages/apps/commise/ui/src/textInput/TextInput.native.tsx';

/** How a source file reaches React Native's `TextInput` as a value. */
const rawTextInputUses = (source: string, fileName: string): readonly string[] =>
    reactNativeValueUses(source, fileName, 'TextInput');

describe('the apps render text fields only through @commise/ui/text-input', () => {
    it('discovers the app sources, including the adapter (a vacuous pass would hide every rule below)', () => {
        const files = appSourceFiles();

        expect(files.length).toBeGreaterThan(100);
        expect(files).toContain(ADAPTER);
    });

    it('finds React Native’s TextInput in the adapter, so the detector reads the real file', () => {
        expect(rawTextInputUses(readFileSync(path.join(repoRoot, ADAPTER), 'utf8'), ADAPTER)).not.toHaveLength(0);
    });

    it('finds it nowhere else', () => {
        const offenders = appSourceFiles()
            .filter((file) => file !== ADAPTER)
            .flatMap((file) =>
                rawTextInputUses(readFileSync(path.join(repoRoot, file), 'utf8'), file).map((use) => `${file}: ${use}`),
            );

        expect(offenders).toEqual([]);
    });
});
