/**
 * The web ingredient row and step row of the recipe page (build spec §6.3, the first slice of 008 FR-035).
 *
 * The WHOLE ingredient row is one checkbox, named with the full line; checked, its text dims — never a strike-through,
 * because a cook re-reads a checked amount. A step stays plain content beside its own 44 px toggle, a `button` with
 * `aria-pressed` named "Mark step {n} as current"; the current step shows the `hereBar`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { makeIngredientView, makeStepView } from '../../__fixtures__/index.js';
import { IngredientCheckRow } from '../IngredientCheckRow.js';
import { StepRow } from '../StepRow.js';

afterEach(cleanup);

const lamb = makeIngredientView({
    ingredientId: 'ing_lamb',
    quantity: { kind: 'exact', value: 2 },
    unit: 'kg',
    name: 'lamb shoulder',
    preparation: 'trimmed of excess fat',
});

describe('IngredientCheckRow (web)', () => {
    it('is one checkbox named with the whole line', () => {
        render(
            <ul>
                <IngredientCheckRow ingredient={lamb} checked={false} allRemoved={false} onToggle={vi.fn()} />
            </ul>,
        );

        const row = screen.getByRole('checkbox', { name: '2 kg lamb shoulder, trimmed of excess fat' });

        expect(row.getAttribute('aria-checked')).toBe('false');
        expect(row.textContent).toContain('lamb shoulder');
        expect(row.textContent).toContain('trimmed of excess fat');
    });

    it('reports a press on the row with the line’s key', () => {
        const onToggle = vi.fn();
        render(
            <ul>
                <IngredientCheckRow ingredient={lamb} checked={false} allRemoved={false} onToggle={onToggle} />
            </ul>,
        );

        fireEvent.click(screen.getByText('lamb shoulder'));

        expect(onToggle).toHaveBeenCalledWith('ing_lamb');
    });

    it('checked: dims the text, with no strike-through', () => {
        render(
            <ul>
                <IngredientCheckRow ingredient={lamb} checked allRemoved={false} onToggle={vi.fn()} />
            </ul>,
        );

        const row = screen.getByRole('checkbox', { name: /lamb shoulder/u });

        expect(row.getAttribute('aria-checked')).toBe('true');
        expect(row.innerHTML).not.toContain('line-through');
        expect(screen.getByText('lamb shoulder').closest('[data-line-text]')?.className).toContain('text-ink-muted');
    });

    it('a status the line carries describes the row', () => {
        const doubted = makeIngredientView({ resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW, name: 'flour' });
        render(
            <ul>
                <IngredientCheckRow ingredient={doubted} checked={false} allRemoved={false} onToggle={vi.fn()} />
            </ul>,
        );

        const describedBy = screen.getByRole('checkbox', { name: /flour/u }).getAttribute('aria-describedby') ?? '';
        expect(document.getElementById(describedBy)?.textContent).toContain('Needs review');
    });

    it('is at least 48 px tall', () => {
        render(
            <ul>
                <IngredientCheckRow ingredient={lamb} checked={false} allRemoved={false} onToggle={vi.fn()} />
            </ul>,
        );

        expect(screen.getByRole('checkbox').className).toContain('min-h-12');
    });
});

describe('StepRow (web)', () => {
    const step = makeStepView({ stepNumber: 3, instruction: 'Rest the lamb for 20 minutes.', timerSeconds: 1200 });

    it('keeps the step text as plain content beside a toggle named for the step', () => {
        render(
            <ol>
                <StepRow step={step} current={false} onToggle={vi.fn()} />
            </ol>,
        );

        const toggle = screen.getByRole('button', { name: 'Mark step 3 as current' });

        expect(toggle.getAttribute('aria-pressed')).toBe('false');
        expect(toggle.textContent).toBe('3');
        expect(toggle.contains(screen.getByText('Rest the lamb for 20 minutes.'))).toBe(false);
    });

    it('reports a press on the toggle with the step number', () => {
        const onToggle = vi.fn();
        render(
            <ol>
                <StepRow step={step} current={false} onToggle={onToggle} />
            </ol>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Mark step 3 as current' }));

        expect(onToggle).toHaveBeenCalledWith(3);
    });

    it('stretches the toggle over the whole step for pointer users, with the timer chip above it', () => {
        render(
            <ol>
                <StepRow step={step} current={false} onToggle={vi.fn()} />
            </ol>,
        );

        expect(screen.getByRole('button', { name: 'Mark step 3 as current' }).className).toContain('after:inset-0');
        expect(screen.getByText('20 min').closest('[data-timer]')?.className).toContain('z-10');
    });

    it('current: pressed, the numeral filled with the action colour, and the here bar shown', () => {
        const { container } = render(
            <ol>
                <StepRow step={step} current onToggle={vi.fn()} />
            </ol>,
        );

        const toggle = screen.getByRole('button', { name: 'Mark step 3 as current' });

        expect(toggle.getAttribute('aria-pressed')).toBe('true');
        expect(toggle.querySelector('[data-numeral]')?.className).toContain('bg-action');
        expect(container.querySelector('[data-here-bar]')).not.toBeNull();
    });

    it('not current: no here bar', () => {
        const { container } = render(
            <ol>
                <StepRow step={step} current={false} onToggle={vi.fn()} />
            </ol>,
        );

        expect(container.querySelector('[data-here-bar]')).toBeNull();
    });

    it('a step with no timer has no timer chip', () => {
        render(
            <ol>
                <StepRow
                    step={makeStepView({ stepNumber: 1, timerSeconds: undefined })}
                    current={false}
                    onToggle={vi.fn()}
                />
            </ol>,
        );

        expect(screen.queryByRole('img', { name: 'Timer' })).toBeNull();
    });
});
