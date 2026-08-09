/**
 * @module @commise/features-cooking/StepDisplay — the web Cooking Mode step surfaces (FR-032, SC-007).
 *
 * The one thing a cook looks at while their hands are busy: ONE step, drawn large enough to read from
 * across the counter. Four single-responsibility presentational components (`props → JSX`, no fetching, no
 * mutation, no refs) — one per render state — which the orchestrating `CookingModeScreen` selects between:
 *  - {@link StepDisplayLoading} — the recipe is still arriving;
 *  - {@link StepDisplayEmpty} — the recipe loaded but has NO steps (FR-032's degenerate case);
 *  - {@link StepDisplayError} — the load failed, with a retry the orchestrator owns;
 *  - {@link StepDisplay} — the populated surface: position readout, optional image, instruction.
 *
 * **Pattern register.** The state split follows the same prescription as `RecipeRatingControl` (B15): a
 * behaviour-switching `mode`/boolean prop is forbidden, so each state is its OWN component and the
 * orchestrator does the choosing. The shared chrome lives once in the internal `StateBlock` scaffold, so
 * the three non-populated states cannot drift on layout. Copy comes only from `cookingMessages`; the
 * dependency points feature → design system (`@commise/ui`), never back.
 *
 * **Accessibility (NFR-003/NFR-004, plan.md §6).** Every element a cook perceives is reachable by role or
 * accessible name: the step is a named `region`, the position readout is a `heading`, the image carries the
 * position as its alt text, loading is a `status` and failure an `alert`. Every state pairs its colour with
 * a glyph AND wording, so no state is carried by colour alone. Type comes from the design system's ramp —
 * `text-display-lg` (36px) for the instruction, over plan.md §6's 32sp floor, and `text-heading-lg` (24px)
 * for everything else — never a magic pixel value.
 *
 * **Two known gaps, deliberately surfaced rather than papered over:**
 *  1. `RecipeStepView` carries no image field (`@kitchensink/recipe-core`), so `imageUrl` is supplied by the
 *     orchestrator. Cooking Mode must not define a recipe-shaped type of its own (GR-007 / D-003).
 *  2. The dictionary has no dedicated alt-text key for a step photo, so the image is named with the step
 *     POSITION ("Step 3 of 8") — a real, localized name rather than a hard-coded English literal. A
 *     `stepImageLabel` key would let the photo be named distinctly from the heading beside it.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import type { FC, ReactNode } from 'react';

import { cookingMessages } from './messages';
import { formatStepPosition, type StepDisplayErrorProps, type StepDisplayProps } from './stepDisplayModel';

/** The in-flight glyph. Decorative — the visible label carries the meaning — and motion-gated. */
const SpinnerGlyph: FC = () => (
    <svg
        className="h-6 w-6 shrink-0 text-slate motion-safe:animate-spin"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
    >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
        <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
);

/** The failure glyph that pairs with the error wording, so the error tone is never colour alone (NFR-004). */
const AlertGlyph: FC = () => (
    <svg
        className="h-6 w-6 shrink-0 text-error-dark"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
    >
        <path d="M12 3 1.5 21h21L12 3Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" fill="none" />
        <path d="M12 9.5v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="17.5" r="1" fill="currentColor" />
    </svg>
);

/** The retry glyph for the error surface's action. Decorative — the Button's label owns the name. */
const RetryGlyph: FC = () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" aria-hidden="true" focusable="false">
        <path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
        <path d="M20 4v5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

/**
 * The shared block the three non-populated states paint: the same width, gutters and rhythm as the step
 * surface, so switching state does not shift the layout under the cook's hands. Keeps that chrome in one
 * place (DRY) — the states differ only in the content they pass as `children`.
 */
const StateBlock: FC<{ children: ReactNode; role?: 'status' | 'alert'; label?: string }> = ({
    children,
    role,
    label,
}) => (
    <div role={role} aria-label={label} className="mx-auto flex w-full max-w-3xl flex-col items-start gap-4 px-4 py-8">
        {children}
    </div>
);

/** The step surface while the recipe is still arriving. Announces itself as a live `status`. */
export const StepDisplayLoading: FC = () => {
    const messages = useMessages(cookingMessages);

    return (
        <StateBlock role="status" label={messages.loadingLabel}>
            <span className="flex items-center gap-3">
                <SpinnerGlyph />
                <span className="text-heading-lg text-slate">{messages.loadingLabel}</span>
            </span>
        </StateBlock>
    );
};

/**
 * The step surface for a recipe that has NO steps — an honest dead end rather than a blank screen or a
 * fabricated "Step 1 of 0". Not an error: nothing failed, there is simply nothing to cook along with.
 */
export const StepDisplayEmpty: FC = () => {
    const messages = useMessages(cookingMessages);

    return (
        <StateBlock>
            <h2 className="font-display text-display-md font-semibold text-charcoal">{messages.emptyTitle}</h2>
            <p className="text-heading-lg text-slate">{messages.emptyBody}</p>
        </StateBlock>
    );
};

/**
 * The step surface for a recipe that could not be loaded: the reason, paired with a glyph, plus a retry
 * that reports upward. The retry itself belongs to the orchestrator — this leaf performs no fetching.
 */
export const StepDisplayError: FC<StepDisplayErrorProps> = ({ onRetry }) => {
    const messages = useMessages(cookingMessages);

    return (
        <StateBlock role="alert">
            {/* A `div`, not a `span`: a `<p>` is flow content and may not sit inside phrasing content. */}
            <div className="flex items-center gap-3">
                <AlertGlyph />
                <p className="text-heading-lg text-error-dark">{messages.errorBody}</p>
            </div>
            <Button variant="secondary" icon={<RetryGlyph />} onPress={onRetry}>
                {messages.retryLabel}
            </Button>
        </StateBlock>
    );
};

/**
 * The populated Cooking Mode step: the localized position readout, an optional illustration, and the
 * instruction itself at the display ramp so it reads from ~3 feet (SC-007).
 */
export const StepDisplay: FC<StepDisplayProps> = ({ step, stepCount, imageUrl }) => {
    const messages = useMessages(cookingMessages);
    const locale = useLocale();
    const position = formatStepPosition(messages.stepPosition, { current: step.stepNumber, total: stepCount }, locale);

    return (
        <section
            aria-label={messages.instructionLabel}
            className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6"
        >
            {imageUrl !== undefined && (
                <img
                    src={imageUrl}
                    // Named distinctly from the position heading beside it: reusing `position` here
                    // makes a screen reader announce the same string twice.
                    alt={formatStepPosition(
                        messages.stepImageLabel,
                        { current: step.stepNumber, total: stepCount },
                        locale,
                    )}
                    loading="lazy"
                    decoding="async"
                    className="h-64 w-full rounded-lg object-cover"
                />
            )}
            <h2 className="text-heading-lg font-semibold text-slate">{position}</h2>
            <p className="text-display-lg font-medium leading-heading text-charcoal">{step.instruction}</p>
        </section>
    );
};
