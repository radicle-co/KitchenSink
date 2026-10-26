/**
 * `withoutVerdictsOnRecord` — the ONE dedup read the save path's verification producer (`RecipesService`) and the paste
 * matcher (`MatchProposalService`) make before they ask the review gate anything (ADR-0071).
 *
 * ⛔ It FAILS OPEN. An unreadable verdict table asks about every item: a duplicate question costs one call, which the
 * worker's own keyed claim then answers for free, while a dropped question leaves a line the gate never judges. The
 * caller says why in its own log, so the failure is visible where the work is.
 *
 * @pattern Template Method — the shared read-and-filter, with the key and the failure report supplied by each caller
 */
import type { LineVerificationsDal } from './dal/lineVerifications.dal.js';

/**
 * The items whose verdict is not already on record.
 *
 * @param verdicts - The verdict table's dedup read.
 * @param items - What the caller is about to ask about.
 * @param keyOf - An item's verification key, or `null` when it has none (it is kept: there is nothing to look up).
 * @param onReadFailure - Told the error when the table could not be read; every item is then kept.
 * @returns The items still owed a question, in order.
 * @sideEffect One keyed verdict read, unless there is nothing to look up.
 */
export async function withoutVerdictsOnRecord<T>(
    verdicts: Pick<LineVerificationsDal, 'findExistingKeys'>,
    items: readonly T[],
    keyOf: (item: T) => string | null,
    onReadFailure: (error: unknown) => void,
): Promise<readonly T[]> {
    const keys = items.flatMap((item) => {
        const key = keyOf(item);

        return key === null ? [] : [key];
    });

    if (keys.length === 0) {
        return items;
    }

    try {
        const onRecord = await verdicts.findExistingKeys(keys);

        return items.filter((item) => {
            const key = keyOf(item);

            return key === null || !onRecord.has(key);
        });
    } catch (error) {
        onReadFailure(error);

        return items;
    }
}
