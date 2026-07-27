/**
 * @module @commise/features-recipes — web recipe clone action (T075 building block).
 *
 * Controlled, presentational clone button plus optional source-attribution line. The button is disabled when
 * cloning is not allowed (`!canClone`) or a clone is in flight (`cloning`), and marked busy while cloning so
 * it cannot be double-submitted. The attribution line renders only when `sourceAttribution` is present. It
 * performs NO mutation — the composing app wires the clone mutation to `onClone`.
 *
 * ## Why this is the design-system `Button` (and why it used to hand-roll a coral pill)
 *
 * This control previously painted its own solid-coral pill, justified by "the mockup paints the clone action
 * coral, and the DS variant set has no coral tier". That premise does not survive checking:
 *
 *  - **No mockup contains a clone action at all** — zero occurrences of clone/duplicate/fork across all nine
 *    screens in `docs/mockups/screens/`. There was never a design that specified this control's colour.
 *  - **The mockups never fill a button coral.** Their only coral BUTTON form is a bordered outline
 *    (`border-2 border-coral text-coral`, filling coral on hover — "Add to Meal Plan", "Change Plan"). The
 *    single solid `bg-coral` in any mockup is a *selected allergy chip*, not an action.
 *  - **Coral's documented role is `Destructive/secondary actions, highlights, warm accents`**, and the mockups
 *    spend it on the Danger Zone and the allergy warning. A filled-coral pill therefore put a safe, additive,
 *    reversible action into the danger register — a semantic miscommunication, not just a cosmetic one.
 *
 * Clone is a quiet SECONDARY action: on the detail footer it is the non-owner's counterpart to the owner's
 * primary Edit, and the discovery-card leaf already describes its own clone control in exactly those words. So
 * both platform leaves wear the DS `secondary` tier and can no longer drift — and the DS supplies, for free,
 * what this component used to re-type and pin with its own tests: the 44px touch floor with the desktop reset,
 * the pill radius, the focus ring, the disabled treatment, the in-place busy spinner, and the press-scale.
 *
 * NOTE the tier is `secondary`, NOT a new coral/accent tier. A new public `ButtonVariant` for one call site is
 * the YAGNI violation the repo's quality gate names explicitly. The genuine open question this surfaced is one
 * layer down and app-wide: `semantic.secondary` IS `palette.coral`, yet the Button's `secondary` tier paints a
 * grey-bordered white pill while every non-primary button in the mockups is coral-outlined. Correcting THAT
 * recolours this control (and every other secondary) in one place — which is exactly why clone belongs on the
 * tier rather than carrying a private copy of the answer.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import { fillTemplate } from '../list/model.js';
import { recipeActionMessages } from './messages.js';
import type { RecipeCloneActionProps } from './model.js';

/**
 * The clone glyph — two offset sheets ("copy"). Decorative only: the DS Button renders every icon inside an
 * `aria-hidden` slot, so the visible label keeps sole ownership of the accessible name.
 */
const CopyIcon: FC = () => (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="9" y="9" width="11" height="11" rx="2" strokeWidth="2" />
        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
);

export const RecipeCloneAction: FC<RecipeCloneActionProps> = ({
    canClone,
    sourceAttribution,
    cloning = false,
    onClone,
}) => {
    const { clone } = useMessages(recipeActionMessages);

    return (
        // `items-start` keeps the pill hugging its label — the DS Button is `inline-flex`, so a stretching
        // column would blow it out to the full footer width (the job the old `self-start` utility did).
        <div className="flex flex-col items-start gap-2">
            {sourceAttribution !== undefined && sourceAttribution.length > 0 && (
                <p className="text-body-sm text-slate">
                    {fillTemplate(clone.attribution, { source: sourceAttribution })}
                </p>
            )}
            {/* `busy` supplies the in-place spinner, the disabled in-flight guard, and `aria-busy`. */}
            <Button variant="secondary" icon={<CopyIcon />} onPress={onClone} disabled={!canClone} busy={cloning}>
                {clone.clone}
            </Button>
            {cloning && (
                <span role="status" className="text-body-sm text-slate">
                    {clone.cloningLabel}
                </span>
            )}
        </div>
    );
};
