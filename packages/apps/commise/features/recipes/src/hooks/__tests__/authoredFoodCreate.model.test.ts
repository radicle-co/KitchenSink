/**
 * U16 — the create-your-own-food model's pure half: draft validation against the PUBLISHED bounds
 * (composed from the food service's own schema), with field errors as localizable keys.
 */
import { describe, expect, it } from 'vitest';

import {
    authoredFoodCreateStateOf,
    draftFromQuery,
    validateAuthoredFoodDraft,
    withAuthoredFoodField,
    type AuthoredFoodCreatePhase,
    type AuthoredFoodDraft,
} from '../authoredFoodCreate.model.js';

function draft(overrides: Partial<AuthoredFoodDraft> = {}): AuthoredFoodDraft {
    return { name: 'Grandma Blend', calories: '100', proteinG: '10', carbsG: '20', fatG: '5', ...overrides };
}

describe('draftFromQuery', () => {
    it('prefills the name from the typed query — the affordance keeps the cook’s words', () => {
        expect(draftFromQuery('grandma blend').name).toBe('grandma blend');
        expect(draftFromQuery('grandma blend').calories).toBe('');
    });
});

describe('validateAuthoredFoodDraft', () => {
    it('parses a complete draft into the wire request', () => {
        const result = validateAuthoredFoodDraft(draft());

        expect(result.ok).toBe(true);

        if (result.ok) {
            expect(result.value).toEqual({
                name: 'Grandma Blend',
                macros: { calories: 100, proteinG: 10, carbsG: 20, fatG: 5 },
            });
        }
    });

    it('an empty name and empty macros report `required` per field', () => {
        const result = validateAuthoredFoodDraft(draft({ name: '  ', calories: '', fatG: ' ' }));

        expect(result.ok).toBe(false);

        if (!result.ok) {
            expect(result.fieldErrors).toEqual({ name: 'required', calories: 'required', fatG: 'required' });
        }
    });

    it('a non-numeric macro reports `not_a_number`', () => {
        const result = validateAuthoredFoodDraft(draft({ proteinG: 'lots' }));

        expect(result.ok).toBe(false);

        if (!result.ok) {
            expect(result.fieldErrors).toEqual({ proteinG: 'not_a_number' });
        }
    });

    it('the PUBLISHED bounds decide range — a macro over 100g/100g is `out_of_range`', () => {
        const result = validateAuthoredFoodDraft(draft({ carbsG: '150' }));

        expect(result.ok).toBe(false);

        if (!result.ok) {
            expect(result.fieldErrors).toEqual({ carbsG: 'out_of_range' });
        }
    });

    it('negative numbers are out of range too — the schema’s min(0), not a local re-statement', () => {
        const result = validateAuthoredFoodDraft(draft({ calories: '-5' }));

        expect(result.ok).toBe(false);

        if (!result.ok) {
            expect(result.fieldErrors).toEqual({ calories: 'out_of_range' });
        }
    });

    /**
     * ⛔ RANGE AND PRESENCE ARE DECIDED IN THE SAME PASS — the regression this file exists to pin.
     *
     * Validation used to run every presence/number check first and RETURN before the range authority ever
     * ran, so the one field the cook actually got wrong said NOTHING while the three they had not reached
     * yet each said `Required`. The out-of-range field only named itself on a SECOND submit, after every
     * other field was already correct — "inline validation renders per field" was true of two of the three
     * verdicts and silently false of the third.
     *
     * The bounds are still the published schema's; what changed is that each field is asked about its OWN
     * value rather than the whole object being asked once, at the end, about all of them.
     */
    it('⛔ names an out-of-range field even while OTHER fields are still empty', () => {
        const result = validateAuthoredFoodDraft(draft({ calories: '', proteinG: '', carbsG: '150', fatG: '' }));

        expect(result.ok).toBe(false);

        if (!result.ok) {
            expect(result.fieldErrors).toEqual({
                calories: 'required',
                proteinG: 'required',
                carbsG: 'out_of_range',
                fatG: 'required',
            });
        }
    });

    it('the same holds for the NAME’s own bound — a too-long name is named beside empty macros', () => {
        // 1,000 characters is past any name bound the published schema could plausibly carry; the BOUND is
        // still the schema's, which is why this asserts the `out_of_range` KEY and never a number.
        const result = validateAuthoredFoodDraft(draft({ name: 'x'.repeat(1_000), calories: '', proteinG: '2' }));

        expect(result.ok).toBe(false);

        if (!result.ok) {
            expect(result.fieldErrors).toEqual({ name: 'out_of_range', calories: 'required' });
        }
    });
});

/**
 * The form's phase is what the cook did; whether a request is in flight is the request's own fact. The state a leaf
 * renders is derived from both, so a phase can never claim a request that is not running.
 */
describe('authoredFoodCreateStateOf', () => {
    const open: AuthoredFoodCreatePhase = {
        kind: 'open',
        draft: draft(),
        fieldErrors: { calories: 'required' },
        submitFailed: true,
    };
    const duplicate: AuthoredFoodCreatePhase = {
        kind: 'duplicate',
        draft: draft(),
        existingFoodId: 'F_prior',
        reuseFailed: true,
    };

    it.each([
        { phase: null, inFlight: { submitting: true, reusePending: true }, expected: { kind: 'closed' } },
        {
            phase: open,
            inFlight: { submitting: false, reusePending: false },
            expected: { kind: 'open', draft: draft(), fieldErrors: { calories: 'required' }, submitFailed: true },
        },
        {
            phase: open,
            inFlight: { submitting: true, reusePending: false },
            expected: { kind: 'submitting', draft: draft() },
        },
        {
            phase: duplicate,
            inFlight: { submitting: false, reusePending: true },
            expected: {
                kind: 'duplicate',
                draft: draft(),
                existingFoodId: 'F_prior',
                reusePending: true,
                reuseFailed: true,
            },
        },
    ] as const)('$phase.kind, in flight $inFlight → $expected.kind', ({ phase, inFlight, expected }) => {
        expect(authoredFoodCreateStateOf(phase, inFlight)).toEqual(expected);
    });
});

describe('withAuthoredFoodField', () => {
    it('sets the field, clears ITS error only, and clears a failed submit', () => {
        const next = withAuthoredFoodField(
            {
                kind: 'open',
                draft: draft({ calories: '' }),
                fieldErrors: { calories: 'required', fatG: 'required' },
                submitFailed: true,
            },
            'calories',
            '120',
        );

        expect(next).toEqual({
            kind: 'open',
            draft: draft({ calories: '120' }),
            fieldErrors: { fatG: 'required' },
            submitFailed: false,
        });
    });

    it.each([null, { kind: 'duplicate', draft: draft(), existingFoodId: 'F', reuseFailed: false } as const])(
        'leaves a form that is not open as it is (%o)',
        (phase) => {
            expect(withAuthoredFoodField(phase, 'name', 'x')).toBe(phase);
        },
    );
});
