/**
 * Every screen and modal in the apps avoids the keyboard through `@commise/ui/keyboard-avoider` — asserted by
 * DISCOVERY, never by a list.
 *
 * ⛔ WHY THIS GUARD EXISTS. On Android this app's windows are edge to edge, and an edge-to-edge window is not resized
 * for the keyboard (E2 I6), so a React Native `KeyboardAvoidingView` must pad on Android too. Three screens padded on
 * iOS only (`behavior={Platform.OS === 'ios' ? 'padding' : undefined}`), the copy that once looked right, while two
 * other places padded on both. `@commise/ui/keyboard-avoider` holds the rule once; this guard keeps the next screen
 * from bypassing it.
 *
 * ⛔ IT ENUMERATES NOTHING. Candidate files come from the FILESYSTEM (every app source file), each read with the
 * TypeScript parser (`reactNativeValueUses.ts`), so a renamed import or a namespace member is caught and a type-only
 * import, which pads nothing, is not. The one module allowed the raw component is the file `@commise/ui` exports as
 * `./keyboard-avoider`, read from its `package.json`, so a moved adapter moves the exemption with it.
 *
 * ✅ THE FIX FOR A FAILURE: import `KeyboardAvoider` from `@commise/ui/keyboard-avoider` instead.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { appSourceFiles, reactNativeValueUses } from './reactNativeValueUses.js';
import { repoRoot } from './serviceSources.js';

/** The design system's package directory, repo-relative. */
const UI_PACKAGE = 'packages/apps/commise/ui';

/** The adapter: the file `@commise/ui` exports as `./keyboard-avoider`, repo-relative; `undefined` if none. */
const adapter = (): string | undefined => {
    const manifest = z
        .object({ exports: z.record(z.string(), z.unknown()) })
        .parse(JSON.parse(readFileSync(path.join(repoRoot, UI_PACKAGE, 'package.json'), 'utf8')));
    const target = z.string().optional().parse(manifest.exports['./keyboard-avoider']);

    return target === undefined ? undefined : path.posix.join(UI_PACKAGE, target);
};

/** How a source file reaches React Native's `KeyboardAvoidingView` as a value. */
const rawAvoiderUses = (source: string, fileName: string): readonly string[] =>
    reactNativeValueUses(source, fileName, 'KeyboardAvoidingView');

describe('the apps avoid the keyboard only through @commise/ui/keyboard-avoider', () => {
    it('discovers the app sources, including the exported adapter (a vacuous pass would hide every rule below)', () => {
        expect(adapter()).toBeDefined();
        expect(appSourceFiles()).toContain(adapter());
    });

    it('finds React Native’s KeyboardAvoidingView in the adapter, so the detector reads the real file', () => {
        const file = adapter() ?? '';

        expect(rawAvoiderUses(readFileSync(path.join(repoRoot, file), 'utf8'), file)).not.toHaveLength(0);
    });

    it('finds it nowhere else', () => {
        const offenders = appSourceFiles()
            .filter((file) => file !== adapter())
            .flatMap((file) =>
                rawAvoiderUses(readFileSync(path.join(repoRoot, file), 'utf8'), file).map((use) => `${file}: ${use}`),
            );

        expect(offenders).toEqual([]);
    });
});
