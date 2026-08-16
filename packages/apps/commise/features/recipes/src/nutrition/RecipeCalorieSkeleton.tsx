/**
 * @module @commise/features-recipes/nutrition — web calorie skeleton (pure render component).
 *
 * **Pattern: Null Object for the pending phase.** The Suspense fallback that stands in for
 * {@link RecipeCalorieChip} while the deferred lookup is in flight — and the ONLY component in this feature
 * that renders the client-only `pending` state. Keeping it separate from the chip is what makes a permanent
 * skeleton unrepresentable: a settled answer is rendered by a component that has no spinner to fall back to.
 *
 * ⛔ **It is deliberately NOT a live region**, unlike `RecipeCardGridSkeleton`. A grid renders one of these
 * PER CARD, so `role="status"` here announces "loading calories" once for every card on entry — twenty
 * times for twenty cards — while the event a reader actually wants, the figure ARRIVING, is never announced
 * at all, because the chip that replaces this is a `role="img"` and not a live region. That is noise where
 * it does not help and silence where it would. The ONE "recipes are loading" announcement belongs to the
 * grid skeleton above it; this leaf is a per-item placeholder underneath that.
 *
 * Two properties it does keep:
 *
 *  1. **The state is real TEXT, not an `aria-label`** — so it is discoverable on navigation. The wrapper
 *     carries no role, and ARIA prohibits naming a generic element: an `aria-label` here would compute to
 *     nothing, which is exactly the defect the chip carried in its first cut, where `getByLabelText` passed
 *     because it reads the attribute rather than the computed name.
 *  2. **The shimmer is decorative** (`aria-hidden`) and honours `prefers-reduced-motion`.
 *
 * The shimmer's box is sized to the chip it replaces, so the card's meta row does not reflow when the figure
 * lands — a row that jumps on every card in a grid is the visible cost of a fallback that reserves nothing.
 */
import type { FC } from 'react';

/** Props for {@link RecipeCalorieSkeleton}. */
export interface RecipeCalorieSkeletonProps {
    /** The localized "loading calories" copy, rendered as visually-hidden TEXT (never an `aria-label`). */
    readonly label: string;
}

/**
 * `h-4` is the meta row's line box and `w-14` is about the width of "420 cal" at `text-body-sm`, so the chip
 * lands in the space the skeleton already held. `inline-block` keeps it in the row's flex flow exactly as the
 * chip's `<span>` sits there.
 */
const SHIMMER_CLASS = 'inline-block h-4 w-14 animate-pulse rounded bg-pearl motion-reduce:animate-none';

/**
 * The in-flight placeholder for one recipe's calorie figure.
 *
 * @param props - The localized loading label.
 * @returns The decorative, reduced-motion-safe shimmer beside visually-hidden text naming the state.
 */
export const RecipeCalorieSkeleton: FC<RecipeCalorieSkeletonProps> = ({ label }) => (
    <span className="inline-flex items-center">
        <span className="sr-only">{label}</span>
        <span aria-hidden="true" className={SHIMMER_CLASS} />
    </span>
);
