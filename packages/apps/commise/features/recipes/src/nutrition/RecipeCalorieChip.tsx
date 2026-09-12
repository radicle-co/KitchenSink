'use client';

/**
 * @module @commise/features-recipes/nutrition — web calorie chip (pure render component).
 *
 * **Pattern: exhaustive switch over a discriminated union (Visitor, satisfied by the language).** A pure
 * `props → JSX` leaf with ONE responsibility: say what a SETTLED calorie lookup found. No data fetching, no
 * state, no effects.
 *
 * ⛔ THERE IS NO `pending` CASE, and that is the point. The in-flight condition is rendered by a DIFFERENT
 * component (`RecipeCalorieSkeleton`) as a Suspense fallback, so this component cannot be asked to
 * render a spinner — which is what makes a permanent skeleton unrepresentable rather than merely unlikely.
 *
 * Two rules this file encodes, neither of which may be "simplified":
 *
 *  1. **`unaccounted` renders NOTHING on a card**, for every reason, and never a spinner. It is the card's
 *     established absent-value rule (absent difficulty / cuisine / tags render nothing), and it is honest: a
 *     terminal answer of "no figure" is not a wait. The REASON is surfaced on the detail surface, where a
 *     reader who came looking for the number is owed it — see `unaccountedReasonText`.
 *  2. **A `known` reading of 0 renders "0 cal".** Water and black coffee genuinely have no energy. The
 *     "we have nothing" invariant lives in the STATE, never in treating a zero as an absence, because an
 *     outage can never reach this member.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { recipeNutritionMessages } from './messages.js';
import { toCalorieChipModel, type RecipeCalorieState } from './model.js';

/** Props for {@link RecipeCalorieChip}. */
export interface RecipeCalorieChipProps {
    /** The SETTLED reading. Structurally cannot be `pending` — that state is the Suspense fallback's. */
    readonly nutrition: RecipeCalorieState;
}

/**
 * A stale figure differs from a fresh one in TWO channels, deliberately.
 *
 * The italic is the sighted reader's cue (subtle, and it leaves the `text-slate` meta colour — and therefore
 * the AA contrast the meta row was tuned to — untouched); the caveat in the accessible name is everyone
 * else's. Marking staleness by styling ALONE would implement only the sighted half of KTD-3b's "serve stale,
 * MARKED", which is the same half-fix that let a cached figure reach a reader unannounced for two releases.
 */
const STALE_CLASS = 'italic';

/**
 * The chip is a `role="img"` named by `RecipeCalorieChipModel.label` — deliberately, and not a bare
 * `<span aria-label>`.
 *
 * A `<span>` with no role maps to `role="generic"`, and ARIA PROHIBITS naming a generic element: the
 * `aria-label` is dropped by the accessible-name computation, so `"420 cal, may be out of date"` degrades
 * back to `"420 cal"` and the caveat never reaches a screen reader. That is precisely the sighted-only
 * marking this component exists to fix, and it would have shipped looking correct, because an attribute-level
 * test (`getByLabelText`) reads the attribute rather than the computed name — the suite queries `getByRole`
 * with a name instead, which goes through the real computation.
 *
 * `role="img"` announces the figure and its caveat as ONE unit rather than letting a reader stitch a number
 * to a qualifier, which is also why the card's star row (`RecipeCard.tsx`'s `CardRating`) already uses it.
 */
const CHIP_ROLE = 'img';

/**
 * The calorie chip: the localized per-serving figure for a settled reading, or nothing at all when the
 * lookup came back with no figure.
 *
 * @param props - The settled reading to render.
 * @returns The chip, or `null` for an `unaccounted` reading.
 */
export const RecipeCalorieChip: FC<RecipeCalorieChipProps> = ({ nutrition }) => {
    const messages = useMessages(recipeNutritionMessages);
    const locale = useLocale();

    switch (nutrition.state) {
        case 'known': {
            const chip = toCalorieChipModel(nutrition, locale, messages);

            return (
                <span role={CHIP_ROLE} aria-label={chip.label} className={chip.isStale ? STALE_CLASS : undefined}>
                    {chip.text}
                </span>
            );
        }

        case 'unaccounted':
            // A terminal answer with no figure — the card says nothing, exactly as it does for an absent
            // difficulty or cuisine. NEVER a spinner, and never a fabricated 0.
            return null;
    }
};
