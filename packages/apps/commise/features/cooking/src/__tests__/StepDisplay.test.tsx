// @vitest-environment jsdom
/**
 * Component tests for the four web Cooking Mode step surfaces (FR-032, SC-007, NFR-003, NFR-004), split
 * one component per render state so the orchestrator picks the surface instead of a mode prop switching
 * behaviour inside one component:
 *  - {@link StepDisplayLoading} — the recipe is still arriving;
 *  - {@link StepDisplayEmpty} — the recipe loaded but has NO steps;
 *  - {@link StepDisplayError} — the recipe could not be loaded, with a retry;
 *  - {@link StepDisplay} — the populated surface: position readout, optional image, instruction.
 *
 * Everything is asserted through `getByRole` / `getByLabelText` (NFR-003) — never `data-testid`, never a
 * CSS colour. Three mutation lenses are carried deliberately:
 *  1. **The position readout reads the step's OWN number**, not an index or a hard-coded 1 — a step with
 *     `stepNumber: 5` of 8 must render "Step 5 of 8", so an off-by-one or index-for-number regression fails.
 *  2. **Each state renders ONLY its own surface** — the loading/empty/error surfaces render no instruction
 *     and no image, so collapsing the split back into one mode-switching component fails here.
 *  3. **SC-007 is measured, not asserted by eye** — the instruction's type-ramp step is resolved back to the
 *     design system's own pixel scale and checked against the 32sp floor, so demoting the ramp fails.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { LocaleProvider } from '@commise/i18n/react';
import { fontSize } from '@commise/ui/scale';

import type { RecipeStepView } from '@kitchensink/recipe-core';

import { StepDisplay, StepDisplayEmpty, StepDisplayError, StepDisplayLoading } from '../StepDisplay';
import type { StepDisplayProps } from '../stepDisplayModel';

afterEach(cleanup);

/** plan.md §6 — instructions are drawn at 32sp or larger so they stay readable at ~3 feet (SC-007). */
const INSTRUCTION_FLOOR_PX = 32;
/** plan.md §6 — every other line of Cooking Mode body copy sits at 24sp or larger. */
const BODY_FLOOR_PX = 24;

/**
 * The design system's type ramp, keyed by the Tailwind utility each step compiles to. Built from
 * `@commise/ui`'s own numeric scale, so a component that swaps `text-display-lg` for a smaller step is
 * measured against the REAL pixel value rather than a number copied into this file.
 */
const RAMP_PX: Readonly<Record<string, number>> = {
    'text-display-xl': fontSize.displayXl,
    'text-display-lg': fontSize.displayLg,
    'text-display-md': fontSize.displayMd,
    'text-heading-lg': fontSize.headingLg,
    'text-heading-md': fontSize.headingMd,
    'text-heading-sm': fontSize.headingSm,
    'text-body-lg': fontSize.bodyLg,
    'text-body-md': fontSize.bodyMd,
    'text-body-sm': fontSize.bodySm,
    'text-caption': fontSize.caption,
    'text-overline': fontSize.overline,
};

/** The pixel size of the design-system ramp utility an element carries, or `undefined` if it carries none. */
function rampPx(element: Element): number | undefined {
    for (const className of Array.from(element.classList)) {
        const px = RAMP_PX[className];
        if (px !== undefined) {
            return px;
        }
    }

    return undefined;
}

function makeStep(overrides: Partial<RecipeStepView> = {}): RecipeStepView {
    return {
        stepNumber: 3,
        instruction: 'Add the chicken and stir for 3 minutes until the internal temp reaches 165°F.',
        ...overrides,
    };
}

function renderStep(overrides: Partial<StepDisplayProps> = {}) {
    const props: StepDisplayProps = { step: makeStep(), stepCount: 8, ...overrides };
    render(
        <LocaleProvider locale="en">
            <StepDisplay {...props} />
        </LocaleProvider>,
    );

    return props;
}

describe('StepDisplayLoading (web) — the recipe is still arriving', () => {
    it('announces the load as a live status with its localized accessible name', () => {
        render(
            <LocaleProvider locale="en">
                <StepDisplayLoading />
            </LocaleProvider>,
        );

        expect(screen.getByRole('status', { name: 'Loading recipe' })).toBeTruthy();
    });

    it('renders NO step surface — no instruction, no image, no position (mutation lens: the split is structural)', () => {
        render(
            <LocaleProvider locale="en">
                <StepDisplayLoading />
            </LocaleProvider>,
        );

        expect(screen.queryByRole('paragraph')).toBeNull();
        expect(screen.queryByRole('img')).toBeNull();
        expect(screen.queryByRole('heading')).toBeNull();
    });

    it('pairs the spinner with a text label, so the state is never carried by motion or colour alone (NFR-004)', () => {
        render(
            <LocaleProvider locale="en">
                <StepDisplayLoading />
            </LocaleProvider>,
        );

        const status = screen.getByRole('status', { name: 'Loading recipe' });

        expect(status.textContent).toBe('Loading recipe');
        // The glyph is decorative: it must not contribute to the accessible name.
        expect(status.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    });
});

describe('StepDisplayEmpty (web) — the recipe has no steps at all', () => {
    it('states the empty case in a heading plus a body line, both from the dictionary', () => {
        render(
            <LocaleProvider locale="en">
                <StepDisplayEmpty />
            </LocaleProvider>,
        );

        expect(screen.getByRole('heading', { name: 'This recipe has no steps yet' })).toBeTruthy();
        expect(screen.getByRole('paragraph').textContent).toBe('Add instructions to the recipe to cook along with it.');
    });

    it('renders no instruction, no image and no retry (mutation lens: an empty recipe is not an error)', () => {
        render(
            <LocaleProvider locale="en">
                <StepDisplayEmpty />
            </LocaleProvider>,
        );

        expect(screen.queryByRole('img')).toBeNull();
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('draws its body copy at the 24sp Cooking Mode floor or larger', () => {
        render(
            <LocaleProvider locale="en">
                <StepDisplayEmpty />
            </LocaleProvider>,
        );

        expect(rampPx(screen.getByRole('paragraph'))).toBeGreaterThanOrEqual(BODY_FLOOR_PX);
    });
});

describe('StepDisplayError (web) — the recipe could not be loaded', () => {
    it('surfaces the failure as an alert carrying the localized reason', () => {
        render(
            <LocaleProvider locale="en">
                <StepDisplayError onRetry={() => undefined} />
            </LocaleProvider>,
        );

        expect(screen.getByRole('alert').textContent).toContain("We couldn't load this recipe.");
        expect(screen.getByRole('paragraph').textContent).toBe("We couldn't load this recipe.");
    });

    it('offers a retry control and reports the request upward EXACTLY once per press', () => {
        const onRetry = vi.fn();
        render(
            <LocaleProvider locale="en">
                <StepDisplayError onRetry={onRetry} />
            </LocaleProvider>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('pairs the error tone with an icon and text, never colour alone (NFR-004)', () => {
        render(
            <LocaleProvider locale="en">
                <StepDisplayError onRetry={() => undefined} />
            </LocaleProvider>,
        );

        const alert = screen.getByRole('alert');

        // A decorative glyph accompanies the wording; the wording is what carries the meaning.
        expect(alert.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
        expect(alert.textContent).toContain("We couldn't load this recipe.");
    });

    it('renders NO step surface (mutation lens: a failed load must not fake a step)', () => {
        render(
            <LocaleProvider locale="en">
                <StepDisplayError onRetry={() => undefined} />
            </LocaleProvider>,
        );

        expect(screen.queryByRole('img')).toBeNull();
        expect(screen.queryByRole('heading')).toBeNull();
    });
});

describe('StepDisplay (web) — the populated step surface', () => {
    it('names the step region with the localized instruction label (NFR-003)', () => {
        renderStep();

        expect(screen.getByRole('region', { name: 'Current step instruction' })).toBeTruthy();
    });

    it('renders the instruction verbatim as the surface’s single body line', () => {
        const { step } = renderStep();

        expect(screen.getByRole('paragraph').textContent).toBe(step.instruction);
    });

    it('reads the position from the step’s OWN number (mutation lens: not an index, not a hard-coded 1)', () => {
        renderStep({ step: makeStep({ stepNumber: 5 }), stepCount: 8 });

        expect(screen.getByRole('heading', { name: 'Step 5 of 8' })).toBeTruthy();
    });

    it('renders the FIRST step’s position', () => {
        renderStep({ step: makeStep({ stepNumber: 1 }), stepCount: 8 });

        expect(screen.getByRole('heading', { name: 'Step 1 of 8' })).toBeTruthy();
    });

    it('renders the LAST step’s position', () => {
        renderStep({ step: makeStep({ stepNumber: 8 }), stepCount: 8 });

        expect(screen.getByRole('heading', { name: 'Step 8 of 8' })).toBeTruthy();
    });

    it('renders a single-step recipe’s position', () => {
        renderStep({ step: makeStep({ stepNumber: 1 }), stepCount: 1 });

        expect(screen.getByRole('heading', { name: 'Step 1 of 1' })).toBeTruthy();
    });

    it('renders the optional image, accessibly named and lazily loaded, when one is supplied', () => {
        renderStep({ imageUrl: 'https://cdn.example.test/step-3.jpg' });

        // Named distinctly from the position heading, so a screen reader does not announce the same
        // string twice — asserting the position string here would lock in that duplication.
        expect(screen.queryByRole('img', { name: 'Step 3 of 8' })).toBeNull();
        const image = screen.getByRole('img', { name: 'Photo for step 3' });

        expect(image.getAttribute('src')).toBe('https://cdn.example.test/step-3.jpg');
        expect(image.getAttribute('loading')).toBe('lazy');
    });

    it('renders NO image element at all when no image is supplied', () => {
        renderStep({ imageUrl: undefined });

        expect(screen.queryByRole('img')).toBeNull();
    });

    it('renders a long instruction in full — never truncated or summarized in the DOM', () => {
        const instruction = `Preheat the oven to 425°F. ${'Fold the dough over itself and rest it. '.repeat(20)}Serve.`;
        renderStep({ step: makeStep({ instruction }) });

        expect(screen.getByRole('paragraph').textContent).toBe(instruction);
    });

    it('draws the instruction at 32sp or larger, so it reads from ~3 feet (SC-007)', () => {
        renderStep();

        expect(rampPx(screen.getByRole('paragraph'))).toBeGreaterThanOrEqual(INSTRUCTION_FLOOR_PX);
    });

    it('draws the position readout at the 24sp Cooking Mode floor or larger', () => {
        renderStep();

        expect(rampPx(screen.getByRole('heading', { name: 'Step 3 of 8' }))).toBeGreaterThanOrEqual(BODY_FLOOR_PX);
    });

    it('renders no loading, error or retry surface while a step is on screen', () => {
        renderStep();

        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.queryByRole('button')).toBeNull();
    });
});
