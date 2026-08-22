/**
 * The prove-your-intent policy, tested at its own seam rather than only through its two callers.
 *
 * `decideClear` and `decideReseed` each compose these two functions with their own preconditions, so a
 * table here pins the shared rule once instead of twice — and, more usefully, pins the ORDERING property
 * that is the reason the policy is two functions rather than one chain.
 */
import { describe, expect, it } from 'vitest';

import {
    PRODUCTION_STAGE,
    decideConfirmation,
    refuseMisplacedProdFlag,
    type OperatorIntent,
} from '../operatorIntent.js';

/** A sandbox run that has proven intent, as the starting point each case varies from. */
function intent(overrides: Partial<OperatorIntent> = {}): OperatorIntent {
    return { stage: 'sandbox', confirm: 'sandbox', allowProd: false, dryRun: false, ...overrides };
}

describe('refuseMisplacedProdFlag', () => {
    it('refuses the production flag anywhere but production', () => {
        expect(refuseMisplacedProdFlag(intent({ allowProd: true }))).toBe('production-flag-off-production');
    });

    it('refuses it even on a dry run, so the habit is never taught', () => {
        // Deliberate: a flag that is harmless when wrong gets pasted into every command until it stops
        // meaning anything, and it must still mean something the one time it is aimed at prod.
        expect(refuseMisplacedProdFlag(intent({ allowProd: true, dryRun: true }))).toBe(
            'production-flag-off-production',
        );
    });

    it('allows it on production, and allows its absence anywhere', () => {
        expect(refuseMisplacedProdFlag(intent({ stage: PRODUCTION_STAGE, allowProd: true }))).toBeUndefined();
        expect(refuseMisplacedProdFlag(intent())).toBeUndefined();
    });
});

describe('decideConfirmation', () => {
    it.each([
        ['a dry run needs no confirmation', intent({ dryRun: true, confirm: undefined }), 'report'],
        ['an unconfirmed write is refused', intent({ confirm: undefined }), 'confirmation-missing'],
        ['a mistyped stage is refused', intent({ confirm: 'sandbx' }), 'confirmation-mismatch'],
        [
            'production without the flag is refused',
            intent({ stage: PRODUCTION_STAGE, confirm: PRODUCTION_STAGE }),
            'production-requires-flag',
        ],
        [
            'production with the flag proceeds',
            intent({ stage: PRODUCTION_STAGE, confirm: PRODUCTION_STAGE, allowProd: true }),
            'proceed',
        ],
        ['a confirmed non-production write proceeds', intent(), 'proceed'],
    ])('%s', (_name, given, expected) => {
        expect(decideConfirmation(given)).toBe(expected);
    });

    it('reports a dry run before asking about production, so looking is never harder than deleting', () => {
        expect(decideConfirmation(intent({ stage: PRODUCTION_STAGE, dryRun: true, confirm: undefined }))).toBe(
            'report',
        );
    });
});
