/**
 * The native ingredient row and step row (build spec §6.3): the mirror of `cookRows.test.tsx`. The whole ingredient
 * row is one `checkbox` named with the full line, dimmed when checked; a step's numeral is its own `button` with a
 * selected state, the step text stays content, and a press anywhere on the step moves the marker for touch users.
 */
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
// The detail leaves draw through the design system's Tamagui components (ADR-0080), so the tree renders in its provider.
import { render, renderWithTamagui, resolvedColour } from '@commise/ui/testing/tamagui';
import { fireEvent } from '@testing-library/dom';

import { role } from '@commise/ui/colors';
import { nativeTokens } from '@commise/ui/native';
import { withPlatformOs } from '@commise/ui/testing/platform-os';
import { rgb } from '@commise/ui/testing/system-color-scheme';

import { makeIngredientView, makeStepView } from '../../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native` leaf.
import { IngredientCheckRow } from '../IngredientCheckRow.native.js';
import { StepRow } from '../StepRow.native.js';

afterEach(cleanup);

const lamb = makeIngredientView({
    ingredientId: 'ing_lamb',
    quantity: { kind: 'exact', value: 2 },
    unit: 'kg',
    name: 'lamb shoulder',
    preparation: 'trimmed of excess fat',
});

describe('IngredientCheckRow (native)', () => {
    // designAnswers.md 2026-11-06 fractions item 6: "unsalted butter · melted", the no-break space before the dot, and the
    // line is named with a comma so the dot is never spoken.
    it('⛔ joins the preparation to the name with a no-break space and a dot, and names the line with a comma', () => {
        const butter = makeIngredientView({
            ingredientId: 'ing_butter',
            quantity: { kind: 'exact', value: 2 },
            unit: 'tablespoons',
            name: 'unsalted butter',
            preparation: 'melted',
        });
        render(<IngredientCheckRow ingredient={butter} checked={false} allRemoved={false} onToggle={vi.fn()} />);

        const row = screen.getByRole('checkbox');

        expect(row.getAttribute('aria-label')).toContain('unsalted butter, melted');
        expect(row.textContent).toContain('unsalted butter\u00A0· melted');
    });

    // ADR-0080 §8: at the largest iOS text size body text stops at 2× (32 pt), and so does the stand-in chip's label
    // (2× its 14 pt caption), which was a raw React Native Text that iOS scaled without a cap.
    it('⛔ draws a stand-in row’s amount at 2× body and its chip label at 2× caption at a text scale of 3.1', () => {
        const hidden = makeIngredientView({
            ingredientId: 'ing_hidden',
            name: '',
            resolutionStatus: FoodResolutionStatus.RESOLVED_UNAVAILABLE,
        });
        renderWithTamagui(
            <IngredientCheckRow ingredient={hidden} checked={false} allRemoved={false} onToggle={vi.fn()} />,
            'light',
            3.1,
        );

        expect(getComputedStyle(screen.getByText('2 tbsp', { exact: false })).fontSize).toBe(
            `${String(nativeTokens.type.body.fontSize * 2)}px`,
        );
        expect(getComputedStyle(screen.getByText('Private ingredient', { exact: false })).fontSize).toBe(
            `${String(nativeTokens.type.caption.fontSize * 2)}px`,
        );
    });

    it('is one checkbox named with the whole line, reporting its key', () => {
        const onToggle = vi.fn();
        render(<IngredientCheckRow ingredient={lamb} checked={false} allRemoved={false} onToggle={onToggle} />);

        const row = screen.getByRole('checkbox', { name: '2 kg lamb shoulder, trimmed of excess fat' });
        expect(row.getAttribute('aria-checked')).toBe('false');

        fireEvent.click(row);
        expect(onToggle).toHaveBeenCalledWith('ing_lamb');
    });

    // WCAG 2.5.3, option C (UI Designer, amending Q5): a CONTROL is named by its visible text, glyph included.
    it('shows 1½ cups and is named by exactly that text', () => {
        const milk = makeIngredientView({
            ingredientId: 'ing_milk',
            quantity: { kind: 'exact', value: 1.5 },
            unit: 'cups',
            name: 'whole milk',
        });
        render(<IngredientCheckRow ingredient={milk} checked={false} allRemoved={false} onToggle={vi.fn()} />);

        const row = screen.getByRole('checkbox', { name: '1½ cups whole milk' });

        expect(row.textContent?.replaceAll('\u00A0', ' ')).toBe('1½ cups whole milk');
    });

    // Owner C5 + T1: the row pads 8 and is at least 44 tall (iOS), sized from the tokens, and a press anywhere on the row (the text
    // included) toggles it. REWRITTEN IN SLICE 2: the line is the `body` role (16), as the board draws it, where it was `list`.
    it('sets the line in the body role, pads 8 and is at least 44 tall', () => {
        render(<IngredientCheckRow ingredient={lamb} checked={false} allRemoved={false} onToggle={vi.fn()} />);

        const row = getComputedStyle(screen.getByRole('checkbox', { name: /lamb shoulder/u }));

        expect(row.minHeight).toBe('44px');
        expect(row.paddingTop).toBe(`${nativeTokens.spacing[2]}px`);
        expect(row.paddingBottom).toBe(`${nativeTokens.spacing[2]}px`);
        expect(getComputedStyle(screen.getByText('lamb shoulder')).fontSize).toBe(
            `${nativeTokens.type.body.fontSize}px`,
        );
    });

    // The web twin's bug (b2b1294bc): the text moved to the 24 `body` line while the box stayed a fixed 1 down, 2 high.
    // The rule: the box is centred in a slot as tall as the body role's line, read from the token so a role change fails
    // here. The device check is the pixel one; this pins the rule jsdom can see.
    it('centres the check box in a slot as tall as the body line', () => {
        render(<IngredientCheckRow ingredient={lamb} checked={false} allRemoved={false} onToggle={vi.fn()} />);

        const slot = getComputedStyle(
            screen.getByRole('checkbox', { name: /lamb shoulder/u }).firstElementChild as Element,
        );

        expect(slot.height).toBe(`${nativeTokens.type.body.lineHeight}px`);
        expect(slot.alignItems).toBe('center');
        expect(slot.marginTop).not.toBe('1px');
    });

    // Parity item 16: a literal 44 gave Android a 44 dp row; the touch floor is 44 pt on iOS and 48 dp on Android
    // (`touchFloor()`, the same source Button and Chip read). Mutation lens: restore the literal and the Android row fails.
    it.each([
        ['ios', '44px'],
        ['android', '48px'],
    ] as const)('is as tall as the platform touch floor on %s', (os, height) => {
        withPlatformOs(os, () => {
            render(<IngredientCheckRow ingredient={lamb} checked={false} allRemoved={false} onToggle={vi.fn()} />);

            expect(getComputedStyle(screen.getByRole('checkbox', { name: /lamb shoulder/u })).minHeight).toBe(height);
        });
    });

    it('toggles when the cook presses the text, not only the box', () => {
        const onToggle = vi.fn();
        render(<IngredientCheckRow ingredient={lamb} checked={false} allRemoved={false} onToggle={onToggle} />);

        fireEvent.click(screen.getByText('lamb shoulder'));
        fireEvent.click(screen.getByText('trimmed of excess fat'));

        expect(onToggle).toHaveBeenCalledTimes(2);
    });

    it('checked: reports checked and dims the text, with no strike-through', () => {
        render(<IngredientCheckRow ingredient={lamb} checked allRemoved={false} onToggle={vi.fn()} />);

        const row = screen.getByRole('checkbox', { name: /lamb shoulder/u });
        expect(row.getAttribute('aria-checked')).toBe('true');
        const name = screen.getByText('lamb shoulder');
        expect(getComputedStyle(name).textDecorationLine ?? '').not.toContain('line-through');
        expect(resolvedColour(name, 'color')).toBe(rgb(role.inkMuted));
    });

    it('unchecked: reports unchecked and keeps the text in ink', () => {
        render(<IngredientCheckRow ingredient={lamb} checked={false} allRemoved={false} onToggle={vi.fn()} />);

        expect(screen.getByRole('checkbox', { name: /lamb shoulder/u }).getAttribute('aria-checked')).toBe('false');
        expect(resolvedColour(screen.getByText('lamb shoulder'), 'color')).toBe(rgb(role.ink));
    });
});

describe('StepRow (native)', () => {
    const step = makeStepView({ stepNumber: 3, instruction: 'Rest the lamb for 20 minutes.', timerSeconds: 1200 });

    it('the numeral is a button named for the step, outside the step text', () => {
        render(<StepRow step={step} current={false} onToggle={vi.fn()} />);

        const toggle = screen.getByRole('button', { name: 'Mark step 3 as current' });
        expect(toggle.getAttribute('aria-pressed')).toBe('false');
        expect(toggle.contains(screen.getByText('Rest the lamb for 20 minutes.'))).toBe(false);
    });

    it('a press on the numeral or on the step text reports the step', () => {
        const onToggle = vi.fn();
        render(<StepRow step={step} current={false} onToggle={onToggle} />);

        fireEvent.click(screen.getByRole('button', { name: 'Mark step 3 as current' }));
        fireEvent.click(screen.getByText('Rest the lamb for 20 minutes.'));

        expect(onToggle).toHaveBeenCalledTimes(2);
        expect(onToggle).toHaveBeenCalledWith(3);
    });

    it('current: reports pressed; a step that is not current reports not pressed', () => {
        const { rerender } = render(<StepRow step={step} current onToggle={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Mark step 3 as current' }).getAttribute('aria-pressed')).toBe(
            'true',
        );

        rerender(<StepRow step={step} current={false} onToggle={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Mark step 3 as current' }).getAttribute('aria-pressed')).toBe(
            'false',
        );
    });

    it('shows the timer as text after the timer glyph', () => {
        render(<StepRow step={step} current={false} onToggle={vi.fn()} />);

        expect(screen.getByText('20 min')).not.toBeNull();
    });
});

describe('IngredientCheckRow (native) — the singular name for a count of one (D21)', () => {
    const onion = makeIngredientView({
        name: 'onions',
        quantity: { kind: 'exact', value: 1 },
        unit: 'large',
        preparation: 'finely chopped',
    });

    it('shows and names "1 large onion", not "onions"', () => {
        render(<IngredientCheckRow ingredient={onion} checked={false} allRemoved={false} onToggle={vi.fn()} />);

        expect(screen.getByRole('checkbox', { name: '1 large onion, finely chopped' })).toBeTruthy();
        expect(screen.getByText('onion')).toBeTruthy();
        expect(screen.queryByText('onions')).toBeNull();
    });

    it('keeps the plural for two', () => {
        render(
            <IngredientCheckRow
                ingredient={{ ...onion, quantity: { kind: 'exact', value: 2 }, unit: '' }}
                checked={false}
                allRemoved={false}
                onToggle={vi.fn()}
            />,
        );

        expect(screen.getByText('onions')).toBeTruthy();
    });
});
