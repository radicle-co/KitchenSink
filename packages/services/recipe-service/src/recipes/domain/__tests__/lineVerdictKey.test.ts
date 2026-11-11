/**
 * The key a verdict about a SAVED line lives under (ADR-0072 §6).
 *
 * ONE authority for "which verdict is this line's": the recipe detail reads a line's verdict with it, and the bulk import
 * stores it beside the saved line so the flagged list and the view's version can read verdicts in SQL. The mutation: a second
 * implementation that drifts (the import would look a verdict up under a key the worker never wrote).
 */
import { describe, expect, it } from 'vitest';
import { verificationKey } from '@kitchensink/recipe-core/resolution/verification-key';

import { sha256Hex } from '../../../common/sha256.js';
import { verifiedLineIdentity } from '../lineVerification.js';
import { verdictKeyOfLine } from '../lineVerdictKey.js';

const LINE = {
    sourceLine: '2 cups whole milk',
    quantity: { kind: 'exact' as const, value: 2 },
    unit: 'cups',
    statedMeasure: undefined,
};

describe('verdictKeyOfLine', () => {
    it('is the key of the line’s verified identity, hashed with the injected digest', () => {
        const identity = verifiedLineIdentity(LINE, 'F-whole');

        expect(identity).toBeDefined();
        expect(verdictKeyOfLine(LINE, 'F-whole', sha256Hex)).toBe(
            identity === undefined ? undefined : verificationKey(identity, sha256Hex),
        );
    });

    it('changes with the food, so a line bound to another food is judged under another key', () => {
        expect(verdictKeyOfLine(LINE, 'F-whole', sha256Hex)).not.toBe(verdictKeyOfLine(LINE, 'F-skim', sha256Hex));
    });

    it('is `undefined` for a line no verdict can exist about: no source text, or no food', () => {
        expect(verdictKeyOfLine({ ...LINE, sourceLine: null }, 'F-whole', sha256Hex)).toBeUndefined();
        expect(verdictKeyOfLine({ ...LINE, sourceLine: '   ' }, 'F-whole', sha256Hex)).toBeUndefined();
        expect(verdictKeyOfLine(LINE, undefined, sha256Hex)).toBeUndefined();
    });
});
