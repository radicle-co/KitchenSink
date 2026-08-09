/**
 * Native component tests for the four Cooking Mode step surfaces (FR-032, SC-007, NFR-003, NFR-004),
 * rendered through react-native-web under jsdom. Mirrors the web suite state-for-state so the two
 * platforms cannot drift: loading, empty, error (with retry), and the populated step — one component per
 * state, selected by the orchestrator rather than by a mode prop.
 *
 * The same three mutation lenses as web: the position readout reads the step's OWN `stepNumber`; each
 * state renders only its own surface; and SC-007 is MEASURED — the instruction's compiled `font-size` is
 * read back off the stylesheet react-native-web emits and checked against the 32sp floor, so demoting the
 * ramp step fails the suite rather than passing unnoticed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { LocaleProvider } from '@commise/i18n/react';
import { fontSize } from '@commise/ui/scale';

import type { RecipeStepView } from '@kitchensink/recipe-core';

// Explicit `.native` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { StepDisplay, StepDisplayEmpty, StepDisplayError, StepDisplayLoading } from '../StepDisplay.native';
import type { StepDisplayProps } from '../stepDisplayModel';

afterEach(cleanup);

/** plan.md §6 — instructions are drawn at 32sp or larger so they stay readable at ~3 feet (SC-007). */
const INSTRUCTION_FLOOR_PX = 32;
/** plan.md §6 — every other line of Cooking Mode body copy sits at 24sp or larger. */
const BODY_FLOOR_PX = 24;

/**
 * The compiled `font-size` (px) of an element, read from the atomic stylesheet react-native-web emits.
 * jsdom does not resolve class-driven values through `getComputedStyle`, so the rule is looked up by the
 * element's own class list — the same technique the recipe-rating native suite uses for `min-width`.
 */
function compiledFontSizePx(element: Element): number | undefined {
    const rules = Array.from(document.styleSheets).flatMap((sheet) => {
        try {
            return Array.from(sheet.cssRules);
        } catch {
            return [];
        }
    });

    let found: number | undefined;
    for (const rule of rules) {
        const selector: string | undefined = (rule as Partial<CSSStyleRule>).selectorText;
        if (selector === undefined || !element.classList.contains(selector.replace(/^\./, ''))) {
            continue;
        }
        const match = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(rule.cssText);
        if (match?.[1] !== undefined) {
            found = Number(match[1]);
        }
    }

    return found;
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

describe('StepDisplayLoading (native) — the recipe is still arriving', () => {
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

        expect(screen.queryByLabelText('Current step instruction')).toBeNull();
        expect(screen.queryByRole('img')).toBeNull();
        expect(screen.queryByRole('heading')).toBeNull();
    });

    it('pairs the spinner with a text label, so the state is never carried by motion or colour alone (NFR-004)', () => {
        render(
            <LocaleProvider locale="en">
                <StepDisplayLoading />
            </LocaleProvider>,
        );

        expect(screen.getByRole('status', { name: 'Loading recipe' }).textContent).toContain('Loading recipe');
    });
});

describe('StepDisplayEmpty (native) — the recipe has no steps at all', () => {
    it('states the empty case in a heading plus a body line, both from the dictionary', () => {
        render(
            <LocaleProvider locale="en">
                <StepDisplayEmpty />
            </LocaleProvider>,
        );

        expect(screen.getByRole('heading', { name: 'This recipe has no steps yet' })).toBeTruthy();
        expect(screen.getByLabelText('Add instructions to the recipe to cook along with it.').textContent).toBe(
            'Add instructions to the recipe to cook along with it.',
        );
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

        const body = screen.getByLabelText('Add instructions to the recipe to cook along with it.');

        expect(compiledFontSizePx(body)).toBeGreaterThanOrEqual(BODY_FLOOR_PX);
    });
});

describe('StepDisplayError (native) — the recipe could not be loaded', () => {
    it('surfaces the failure as an alert carrying the localized reason', () => {
        render(
            <LocaleProvider locale="en">
                <StepDisplayError onRetry={() => undefined} />
            </LocaleProvider>,
        );

        expect(screen.getByRole('alert').textContent).toContain("We couldn't load this recipe.");
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

    it('pairs the error tone with wording, never colour alone (NFR-004)', () => {
        render(
            <LocaleProvider locale="en">
                <StepDisplayError onRetry={() => undefined} />
            </LocaleProvider>,
        );

        expect(screen.getByLabelText("We couldn't load this recipe.").textContent).toBe(
            "We couldn't load this recipe.",
        );
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

describe('StepDisplay (native) — the populated step surface', () => {
    it('names the instruction with its localized accessible name (NFR-003)', () => {
        const { step } = renderStep();

        expect(screen.getByLabelText('Current step instruction').textContent).toBe(step.instruction);
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

    it('renders the optional image, accessibly named, when one is supplied', () => {
        renderStep({ imageUrl: 'https://cdn.example.test/step-3.jpg' });

        // Named distinctly from the position heading, so a screen reader does not announce the same
        // string twice — asserting the position string here would lock in that duplication.
        expect(screen.getByRole('img', { name: 'Photo for step 3' })).toBeTruthy();
        expect(screen.queryByRole('img', { name: 'Step 3 of 8' })).toBeNull();
        expect(document.body.innerHTML).toContain('https://cdn.example.test/step-3.jpg');
    });

    it('renders NO image element at all when no image is supplied', () => {
        renderStep({ imageUrl: undefined });

        expect(screen.queryByRole('img')).toBeNull();
    });

    it('renders a long instruction in full — never truncated or summarized', () => {
        const instruction = `Preheat the oven to 425°F. ${'Fold the dough over itself and rest it. '.repeat(20)}Serve.`;
        renderStep({ step: makeStep({ instruction }) });

        expect(screen.getByLabelText('Current step instruction').textContent).toBe(instruction);
    });

    it('draws the instruction at 32sp or larger, so it reads from ~3 feet (SC-007)', () => {
        renderStep();

        expect(compiledFontSizePx(screen.getByLabelText('Current step instruction'))).toBeGreaterThanOrEqual(
            INSTRUCTION_FLOOR_PX,
        );
    });

    it('draws the position readout at the 24sp Cooking Mode floor or larger', () => {
        renderStep();

        expect(compiledFontSizePx(screen.getByRole('heading', { name: 'Step 3 of 8' }))).toBeGreaterThanOrEqual(
            BODY_FLOOR_PX,
        );
    });

    it('renders no loading, error or retry surface while a step is on screen', () => {
        renderStep();

        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.queryByRole('button')).toBeNull();
    });
});

describe('StepDisplay (native) — instruction ramp agrees with the design system', () => {
    it('draws the instruction at the display-lg ramp step, single-sourced from @commise/ui', () => {
        renderStep();

        expect(compiledFontSizePx(screen.getByLabelText('Current step instruction'))).toBe(fontSize.displayLg);
    });
});
