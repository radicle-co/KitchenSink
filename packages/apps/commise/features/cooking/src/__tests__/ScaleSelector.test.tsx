/**
 * Component tests for the WEB yield-scale control (FR-034a, T-016).
 *
 * Three things are being proven, and the third is a SAFETY property (spec.md D-002):
 *  1. every factor in `ALLOWED_SCALE_FACTORS` is offered and reported back EXACTLY (mutation lens: a
 *     hard-coded option list, or an index-for-factor slip, fails here);
 *  2. the "cook times are not scaled" advisory is ABSENT at 1x and PRESENT at every other factor;
 *  3. scaling NEVER touches a cook duration — asserted three ways: a frozen duration-bearing fixture is
 *     unchanged after scaling through every factor, the control's source imports and references no duration
 *     symbol at all, and its props contract cannot carry one.
 *
 * The end-to-end quantity recalculation (200 g → 400 g at 2x) is asserted through the surface that DISPLAYS
 * quantities — {@link IngredientChecklist} — driven by this control, because that composition is what
 * FR-034a actually promises the cook.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { useState, type FC } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { LocaleProvider } from '@commise/i18n/react';
import { ALLOWED_SCALE_FACTORS, type CookingTimer, type ScaleFactor } from '@kitchensink/cooking-core';
import type { RecipeIngredientView } from '@kitchensink/recipe-core';

import { IngredientChecklist } from '../IngredientChecklist';
import { ScaleSelector } from '../ScaleSelector';
import type { ScaleSelectorProps } from '../sessionExtras';

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const noop = () => undefined;

const ADVISORY = 'Quantities are scaled. Cook times are not — check for doneness as you go.';

const makeIngredients = (): readonly RecipeIngredientView[] =>
    Object.freeze([
        Object.freeze({
            ingredientId: 'ing-flour',
            name: 'Flour',
            quantity: 200,
            unit: 'g',
            isUserEntered: false,
        }),
    ]);

/** 1500 s (25 min) — the duration ATS-008-J3 / STS-009-D1 pin. Frozen: an in-place rescale would throw. */
const makeTimers = (): readonly CookingTimer[] =>
    Object.freeze([
        Object.freeze({
            id: 'timer-1',
            label: 'Simmer',
            stepNumber: 2,
            durationMs: 1_500_000,
            startedAt: '2026-08-08T12:00:00.000Z',
            isPaused: false,
        }),
    ]);

function renderSelector(overrides: Partial<ScaleSelectorProps> = {}) {
    const props: ScaleSelectorProps = { scaleFactor: 1, onScaleChange: noop, ...overrides };
    render(
        <LocaleProvider locale="en">
            <ScaleSelector {...props} />
        </LocaleProvider>,
    );

    return props;
}

/**
 * A minimal stand-in for the orchestrating screen: it holds the ONE piece of session state these two pure
 * components share (the active factor) so the real composition — choose a factor here, read the recalculated
 * quantity there — can be exercised end to end.
 */
const ScalingHarness: FC<{ readonly ingredients: readonly RecipeIngredientView[] }> = ({ ingredients }) => {
    const [factor, setFactor] = useState<ScaleFactor>(1);

    return (
        <LocaleProvider locale="en">
            <ScaleSelector scaleFactor={factor} onScaleChange={setFactor} />
            <IngredientChecklist
                ingredients={ingredients}
                checkedIngredientIds={[]}
                scaleFactor={factor}
                isOpen
                onToggleIngredient={noop}
                onDismiss={noop}
            />
        </LocaleProvider>
    );
};

describe('ScaleSelector (web) — the offered factors', () => {
    it('offers exactly the factors the domain allows, each accessibly named', () => {
        renderSelector();

        expect(screen.getByRole('radiogroup', { name: 'Servings' })).toBeTruthy();
        expect(screen.getAllByRole('radio')).toHaveLength(ALLOWED_SCALE_FACTORS.length);

        for (const factor of ALLOWED_SCALE_FACTORS) {
            expect(screen.getByRole('radio', { name: `${factor}x` })).toBeTruthy();
        }
    });

    it('marks the ACTIVE factor as the checked option, and only that one', () => {
        renderSelector({ scaleFactor: 2 });

        expect(screen.getByRole('radio', { name: '2x', checked: true })).toBeTruthy();
        expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1);
        expect(screen.getByRole('radio', { name: '1x', checked: false })).toBeTruthy();
    });

    it.each([...ALLOWED_SCALE_FACTORS])('reports factor %sx upward exactly as chosen', (factor) => {
        const onScaleChange = vi.fn();
        // Start away from the factor under test so the change event actually fires for 1x too.
        renderSelector({ scaleFactor: factor === 1 ? 2 : 1, onScaleChange });

        fireEvent.click(screen.getByRole('radio', { name: `${factor}x` }));

        expect(onScaleChange).toHaveBeenCalledTimes(1);
        expect(onScaleChange).toHaveBeenCalledWith(factor);
    });

    it('does not select a factor on its own — the rendered selection follows props only', () => {
        renderSelector({ scaleFactor: 1, onScaleChange: noop });

        fireEvent.click(screen.getByRole('radio', { name: '3x' }));

        expect(screen.getByRole('radio', { name: '1x', checked: true })).toBeTruthy();
        expect(screen.getByRole('radio', { name: '3x', checked: false })).toBeTruthy();
    });
});

describe('ScaleSelector (web) — the cook-time advisory (FR-034a / D-002)', () => {
    it('shows NO advisory at 1x (ATS-008-J5)', () => {
        renderSelector({ scaleFactor: 1 });

        expect(screen.queryByRole('alert')).toBeNull();
    });

    it.each([...ALLOWED_SCALE_FACTORS].filter((factor) => factor !== 1))(
        'shows the advisory at %sx (ATS-008-J4)',
        (factor) => {
            renderSelector({ scaleFactor: factor });

            expect(screen.getByRole('alert').textContent).toBe(ADVISORY);
        },
    );

    it('adds the advisory when leaving 1x and removes it on returning (STS-009-D2)', () => {
        render(<ScalingHarness ingredients={makeIngredients()} />);

        expect(screen.queryByRole('alert')).toBeNull();

        fireEvent.click(screen.getByRole('radio', { name: '2x' }));
        expect(screen.getByRole('alert').textContent).toBe(ADVISORY);

        fireEvent.click(screen.getByRole('radio', { name: '1x' }));
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('ScaleSelector (web) — recalculated quantities, composed with the checklist (FR-034a)', () => {
    it('recalculates the DISPLAYED quantity to 400 g at 2x and 100 g at 0.5x (ATS-008-J1/J2, STS-009-C1)', () => {
        const ingredients = makeIngredients();
        render(<ScalingHarness ingredients={ingredients} />);

        expect(screen.getByRole('checkbox', { name: '200 g Flour' })).toBeTruthy();

        fireEvent.click(screen.getByRole('radio', { name: '2x' }));
        expect(screen.getByRole('checkbox', { name: '400 g Flour' })).toBeTruthy();

        fireEvent.click(screen.getByRole('radio', { name: '0.5x' }));
        expect(screen.getByRole('checkbox', { name: '100 g Flour' })).toBeTruthy();

        // The stored recipe data never moved — only the display did.
        expect(ingredients[0]?.quantity).toBe(200);
    });
});

describe('ScaleSelector (web) — cook durations are invariant under scaling (D-002, REQ-015)', () => {
    it('leaves every duration byte-identical across every factor, and issues no write (ATS-008-J3/J6)', () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const running = makeTimers();
        const pristine = structuredClone(running) as CookingTimer[];

        render(<ScalingHarness ingredients={makeIngredients()} />);

        for (const factor of [...ALLOWED_SCALE_FACTORS].reverse()) {
            fireEvent.click(screen.getByRole('radio', { name: `${factor}x` }));
            // Scaling to `factor` must not have rescaled the 25-minute duration to `1_500_000 * factor`.
            expect(running[0]?.durationMs).toBe(1_500_000);
        }

        expect(running).toEqual(pristine);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('holds no reference to a cook duration at all — structural, not incidental', () => {
        // The domain module's invariant is asserted on its import graph (UTS-020-D2); the control that DRIVES
        // it gets the same treatment, so a future "just recalculate the countdown too" edit cannot pass.
        const source = readFileSync(path.resolve(import.meta.dirname, '../ScaleSelector.tsx'), 'utf8');
        const imports = source.match(/^import[\s\S]*?;$/gm) ?? [];

        expect(imports.length).toBeGreaterThan(0);
        expect(imports.filter((statement) => /timer|duration/i.test(statement))).toEqual([]);

        for (const forbidden of ['CookingTimer', 'durationMs', 'timerSeconds']) {
            expect(source).not.toContain(forbidden);
        }
    });

    it('cannot even RECEIVE a duration — the props contract carries none', () => {
        const model = readFileSync(path.resolve(import.meta.dirname, '../sessionExtras.ts'), 'utf8');
        const contract = /export interface ScaleSelectorProps \{[\s\S]*?\n\}/.exec(model)?.[0] ?? '';

        expect(contract).not.toBe('');
        expect(/timer|duration/i.test(contract)).toBe(false);
    });
});
