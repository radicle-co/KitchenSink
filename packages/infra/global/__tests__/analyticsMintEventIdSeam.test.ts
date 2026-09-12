/**
 * Analytics U5 (staff-architect REVIEW F1) — the event-id minter stays a PLATFORM SEAM.
 *
 * ⛔ WHY: Hermes ships no `crypto` global and Expo's winter runtime does not install one (verified
 * against RN 0.86's core setup and Expo 57's `runtime.native.ts`), so a bare `crypto.randomUUID()`
 * inside the SHARED resolver hook throws `ReferenceError` on the first successful ingredient search
 * on a device — an effect-phase throw that unmounts the recipe-editing surface. No vitest tier can
 * observe it (Node 24 and jsdom both HAVE the global); only a device would. So the rule is guarded at
 * the SOURCE, in both directions: the shared hook reaches ids only through `mintEventId`, and the
 * native leaf delegates to `expo-crypto` — never the global Hermes lacks.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const FEATURES = join(repoRoot, 'packages/apps/commise/features/recipes/src');

describe('the analytics event-id minter platform seam (F1)', () => {
    it('the shared resolver hook never touches the bare crypto global', () => {
        const hookSource = readFileSync(join(FEATURES, 'hooks/useIngredientResolver.ts'), 'utf8');

        expect(hookSource).not.toMatch(/\bcrypto\./);
        expect(hookSource).toContain('mintEventId');
    });

    it('the native leaf exists, delegates to expo-crypto, and never touches the global Hermes lacks', () => {
        const nativeSource = readFileSync(join(FEATURES, 'analytics/mintEventId.native.ts'), 'utf8');

        expect(nativeSource).toContain("from 'expo-crypto'");
        expect(nativeSource).not.toMatch(/globalThis\.crypto|\bcrypto\.randomUUID/);
    });

    it('the web leaf exists beside it — Metro takes .native, every web bundler takes this one', () => {
        const webSource = readFileSync(join(FEATURES, 'analytics/mintEventId.ts'), 'utf8');

        expect(webSource).toContain('crypto.randomUUID()');
        // The docstring may NAME expo-crypto (it explains the seam); it must not IMPORT it.
        expect(webSource).not.toMatch(/from 'expo-crypto'/);
    });
});
