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
    describeTargetToken,
    refuseMisplacedProdFlag,
    refuseUnboundTarget,
    type DatabaseTarget,
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

/**
 * ⛔ THE GUARD THE STAGE FLAGS NEVER WERE (PR #91 review). `--stage`/`--confirm` are the operator DECLARING
 * what they believe; nothing bound that belief to the database the process actually opened, so
 * `--stage prod --allow-prod --confirm prod` was accepted with `DATABASE_URL` pointed anywhere — and the
 * commands' own docstrings admitted it, calling the printed target "the honest limit of the guard, made
 * visible". Printing a target is not a check. These two functions make the operator name the target the
 * SERVER reported, and refuse a stage that cannot possibly be the database in front of it.
 */
describe('refuseUnboundTarget', () => {
    /** The live descriptor a sandbox connection reports. */
    function target(overrides: Partial<DatabaseTarget> = {}): DatabaseTarget {
        return { host: '10.1.4.7', port: 5432, database: 'kitchensink_food', user: 'food_app', ...overrides };
    }

    it('is what an operator must type back, verbatim — database@host:port', () => {
        expect(describeTargetToken(target())).toBe('kitchensink_food@10.1.4.7:5432');
    });

    it('refuses a WRITING run that named no target at all', () => {
        expect(refuseUnboundTarget(intent({ confirmTarget: undefined }), target())).toBe('target-confirmation-missing');
    });

    it('⛔ refuses the exact reported case: prod declared, sandbox connected', () => {
        // The operator typed the production target they believed they were on; the connection landed on the
        // sandbox server. Every stage flag is satisfied and the run is still refused.
        const declared = 'kitchensink_food@10.0.9.2:5432';

        expect(
            refuseUnboundTarget(
                intent({
                    stage: PRODUCTION_STAGE,
                    confirm: PRODUCTION_STAGE,
                    allowProd: true,
                    confirmTarget: declared,
                }),
                target({ host: '10.1.4.7' }),
            ),
        ).toBe('target-mismatch');
    });

    it('admits a run whose typed target is the one the server reported', () => {
        expect(refuseUnboundTarget(intent({ confirmTarget: describeTargetToken(target()) }), target())).toBeUndefined();
    });

    it('ignores surrounding whitespace but never a differing database, host or port', () => {
        expect(
            refuseUnboundTarget(intent({ confirmTarget: '  kitchensink_food@10.1.4.7:5432  ' }), target()),
        ).toBeUndefined();
        expect(refuseUnboundTarget(intent({ confirmTarget: 'kitchensink_food@10.1.4.7:5433' }), target())).toBe(
            'target-mismatch',
        );
        expect(refuseUnboundTarget(intent({ confirmTarget: 'kitchensink_food_pr_7@10.1.4.7:5432' }), target())).toBe(
            'target-mismatch',
        );
    });

    /**
     * ⛔ The half that needs NO typing, and catches what typing cannot: a per-PR database is named for its own
     * stage, so `pr-7` and `kitchensink_food_pr_9` cannot both be true no matter what the operator confirms.
     * It is checked even on a DRY RUN — like the misplaced prod flag, it is wrong before it is harmless, and a
     * dry run's whole job is to report on the run that would follow.
     */
    describe('the stage and the database it landed on must be able to be true together', () => {
        it.each([
            ['a pr stage on ANOTHER pr database', 'pr-7', 'kitchensink_food_pr_9'],
            ['a pr stage on the shared base database', 'pr-7', 'kitchensink_food'],
            ['production on a per-PR database', PRODUCTION_STAGE, 'kitchensink_food_pr_7'],
            ['sandbox on a per-PR database', 'sandbox', 'kitchensink_recipes_pr_12'],
        ])('refuses %s', (_name, stage, database) => {
            expect(
                refuseUnboundTarget(intent({ stage, confirm: stage, confirmTarget: 'x' }), target({ database })),
            ).toBe('stage-database-mismatch');
        });

        it.each([
            ['a pr stage on its own database', 'pr-7', 'kitchensink_food_pr_7'],
            ['production on the shared base database', PRODUCTION_STAGE, 'kitchensink_food'],
            ['sandbox on the shared base database', 'sandbox', 'kitchensink_recipes'],
            ['a local stage on a local database', 'local', 'commise'],
        ])('admits %s', (_name, stage, database) => {
            const live = target({ database });

            expect(
                refuseUnboundTarget(
                    intent({
                        stage,
                        confirm: stage,
                        allowProd: stage === PRODUCTION_STAGE,
                        confirmTarget: describeTargetToken(live),
                    }),
                    live,
                ),
            ).toBeUndefined();
        });

        it('is refused BEFORE the typed target, so an impossible pairing is not reported as a typo', () => {
            expect(
                refuseUnboundTarget(intent({ stage: 'pr-7', confirm: 'pr-7', confirmTarget: undefined }), target()),
            ).toBe('stage-database-mismatch');
        });

        it('checks the impossible pairing even on a dry run, but never asks a dry run to type a target', () => {
            expect(refuseUnboundTarget(intent({ stage: 'pr-7', dryRun: true, confirm: undefined }), target())).toBe(
                'stage-database-mismatch',
            );
            expect(refuseUnboundTarget(intent({ dryRun: true, confirm: undefined }), target())).toBeUndefined();
        });
    });
});
