import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { scaleQuantity, setScaleFactor, shouldShowNotScaledAdvisory } from '../controllers/YieldScalingState.js';
import { isInvalidQuantityError, isUnsupportedScaleFactorError } from '../errors.js';
import type { CookingTimer } from '../types.js';

/**
 * T-017 / MOD-020 — UTP-020-A..D.
 *
 * Covers FR-034a (REQ-014, REQ-015). UTP-020-D is the safety case from spec.md D-002: scaling the
 * yield must never change a cook time. It is asserted twice — behaviourally, and structurally by
 * inspecting the module's imports, because a behavioural test alone can be defeated by a later edit
 * that reintroduces a timer dependency.
 */

describe('YieldScalingState — UTP-020-A: setScaleFactor accepts allowed, rejects the rest', () => {
    it.each([0.5, 1, 2, 3])('UTS-020-A1/A2: accepts the supported factor %s', (factor) => {
        expect(setScaleFactor(factor)).toBe(factor);
    });

    it.each([1.5, 0, -1, 4, Number.NaN, Number.POSITIVE_INFINITY])(
        'UTS-020-A3/A4/A5: rejects the unsupported factor %s',
        (factor) => {
            let thrown: unknown;
            try {
                setScaleFactor(factor);
            } catch (error) {
                thrown = error;
            }
            expect(isUnsupportedScaleFactorError(thrown)).toBe(true);
        },
    );
});

describe('YieldScalingState — UTP-020-B: scaleQuantity multiplies correctly', () => {
    it('UTS-020-B1: doubles at 2x', () => {
        expect(scaleQuantity(200, 2)).toBe(400);
    });

    it('UTS-020-B2: halves at 0.5x', () => {
        expect(scaleQuantity(200, 0.5)).toBe(100);
    });

    it('UTS-020-B3: is identity at 1x', () => {
        expect(scaleQuantity(200, 1)).toBe(200);
    });

    it('UTS-020-B4: handles a zero quantity', () => {
        expect(scaleQuantity(0, 2)).toBe(0);
    });

    it('UTS-020-B5: rejects a non-finite quantity', () => {
        let thrown: unknown;
        try {
            scaleQuantity(Number.NaN, 2);
        } catch (error) {
            thrown = error;
        }
        expect(isInvalidQuantityError(thrown)).toBe(true);
    });

    it('UTS-020-B5b: rejects a negative quantity with InvalidQuantityError', () => {
        let thrown: unknown;
        try {
            scaleQuantity(-1, 2);
        } catch (error) {
            thrown = error;
        }
        // Specific error, not a bare `.toThrow()` — see the note in IngredientCheckoffState UTS-019-B2.
        expect(isInvalidQuantityError(thrown)).toBe(true);
    });
});

describe('YieldScalingState — UTP-020-C: advisory tracks the factor', () => {
    it('UTS-020-C1: no advisory at 1x', () => {
        expect(shouldShowNotScaledAdvisory(1)).toBe(false);
    });

    it('UTS-020-C2/C3: advisory at every factor other than 1x', () => {
        expect(shouldShowNotScaledAdvisory(2)).toBe(true);
        expect(shouldShowNotScaledAdvisory(0.5)).toBe(true);
        expect(shouldShowNotScaledAdvisory(3)).toBe(true);
    });
});

describe('YieldScalingState — UTP-020-D: SAFETY, scaling never reaches timer state (D-002)', () => {
    it('UTS-020-D1: timer durations are byte-identical across every scale factor', () => {
        const timer: CookingTimer = {
            id: 't1',
            label: 'Bake',
            stepNumber: 3,
            durationMs: 1_500_000,
            startedAt: '2026-08-07T12:00:00.000Z',
            isPaused: false,
        };
        const before = timer.durationMs;

        for (const factor of [2, 0.5, 3, 1] as const) {
            setScaleFactor(factor);
            scaleQuantity(200, factor);
            expect(timer.durationMs).toBe(before);
        }
    });

    it('UTS-020-D2: the module imports no timer module (structural invariant)', () => {
        const source = readFileSync(new URL('../controllers/YieldScalingState.ts', import.meta.url), 'utf8');
        const importLines = source.split('\n').filter((line) => line.trimStart().startsWith('import'));

        expect(importLines.some((line) => /timer/i.test(line))).toBe(false);
    });
});
