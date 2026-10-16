/**
 * `AnsweredRoots` — the one door through which an answer that names catalog roots holds them against the test purge
 * (ADR-0040, food half; owner ruling 2026-10-16, "Clean up test-picked foods").
 *
 * @pattern Command — marks the roots an answer disclosed; the decision of WHO holds is the Specification
 *   `domain/testPickedRootPolicy.ts`, so this file holds no predicate of its own.
 *
 * ## Why every answering route calls it
 *
 * A root a test principal's pick created is deletable by that principal's purge unless a real cook relies on it, and
 * food-service cannot see what a recipe binds (the recipe service keeps opaque food ids). The only fact it holds is
 * that it TOLD someone the id, so every route that discloses a root id to a caller calls {@link AnsweredRoots.hold}.
 *
 * ⛔ The hold is written BEFORE the answer leaves, and a failed hold fails the answer. A cook persists an id only after
 * receiving it, so a hold committed before the answer is committed before any recipe can bind the id; a purge that
 * wins the row lock first merely deletes a root nobody had yet been told. An answer that left first and held
 * afterwards would reopen the window in which a recipe binds an id the purge then deletes.
 *
 * It costs one primary-key `UPDATE` per answer, which writes and locks no row when no test principal created the root
 * or it is already held: the common path.
 */
import { Injectable } from '@nestjs/common';

import type { TestPickedRootDao } from './dao/testPickedRoot.dao.js';
import { marksRealHold, type AnswerAudience } from './domain/testPickedRootPolicy.js';

@Injectable()
export class AnsweredRoots {
    /** @param dao - The attribution table's gateway. */
    public constructor(private readonly dao: Pick<TestPickedRootDao, 'markHeldByRealUser'>) {}

    /**
     * Hold the roots an answer named, when the answer's audience is not a test principal.
     *
     * @param audience - The verified principal, or `undefined` for an answer no principal shaped.
     * @param ids - The ids the answer names; ids that are not test-picked roots change nothing.
     * @throws Whatever the database throws; the answer must not be sent then.
     * @sideEffect May update `test_picked_root` rows.
     */
    public async hold(audience: AnswerAudience, ids: readonly string[]): Promise<void> {
        if (!marksRealHold(audience)) {
            return;
        }

        const distinct = [...new Set(ids)];

        if (distinct.length === 0) {
            return;
        }

        await this.dao.markHeldByRealUser(distinct);
    }
}
