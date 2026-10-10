/**
 * U10 — what "the provider owes this account a change" means (R26/R27).
 *
 * Shared because two very different readers must agree on it: the deletion worker settles the version pair,
 * and the U12 backstop escalates rows where it is still unequal. A predicate spelled twice is the drift that
 * makes a backstop report work nobody owes, or miss work somebody does.
 */
import { describe, expect, it } from 'vitest';

import { providerChangeIsOwed } from '../statusConvergence.js';

describe('providerChangeIsOwed', () => {
    it('owes nothing when the applied version has caught up', () => {
        expect(providerChangeIsOwed({ status: 'active', statusVersion: 3, statusAppliedVersion: 3 })).toBe(false);
    });

    it('owes a change when the applied version is behind the intent', () => {
        expect(providerChangeIsOwed({ status: 'tombstoned', statusVersion: 4, statusAppliedVersion: 3 })).toBe(true);
    });

    /**
     * ⚠️ Not `<`. A settle writes the version it READ, so an applied version can only equal or lag an intent
     * under normal operation — but a restored backup or a hand-repair could leave it AHEAD, and "ahead" is
     * still a disagreement between the database and the provider. Inequality is the honest question.
     */
    it('owes a change when the applied version is somehow AHEAD — inequality, not lag', () => {
        expect(providerChangeIsOwed({ status: 'active', statusVersion: 2, statusAppliedVersion: 5 })).toBe(true);
    });

    /**
     * ⛔ AN ERASED ACCOUNT IS NEVER OWED, whatever the versions say. Erasure has its own path — it deletes at
     * Clerk and fans out to recipe and food — so converging an erased identity would either fail against a
     * deleted Clerk user or resurrect state the erasure removed. The exclusion is explicit rather than left
     * to the versions happening to agree, which would make the safety an accident of bookkeeping.
     */
    it('⛔ never owes a change for an ERASED account, even with the versions disagreeing', () => {
        expect(providerChangeIsOwed({ status: 'erased', statusVersion: 9, statusAppliedVersion: 1 })).toBe(false);
    });

    it('owes a change for a suspended account whose intent has moved', () => {
        expect(providerChangeIsOwed({ status: 'suspended', statusVersion: 2, statusAppliedVersion: 1 })).toBe(true);
    });
});
