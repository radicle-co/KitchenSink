/**
 * The native ingredient row and step row (build spec §6.3): the mirror of `cookRows.test.tsx`. The whole ingredient
 * row is one `checkbox` named with the full line, dimmed when checked; a step's numeral is its own `button` with a
 * selected state, the step text stays content, and a press anywhere on the step moves the marker for touch users.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { role } from '@commise/ui/colors';
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
    it('is one checkbox named with the whole line, reporting its key', () => {
        const onToggle = vi.fn();
        render(<IngredientCheckRow ingredient={lamb} checked={false} allRemoved={false} onToggle={onToggle} />);

        const row = screen.getByRole('checkbox', { name: '2 kg lamb shoulder, trimmed of excess fat' });
        expect(row.getAttribute('aria-checked')).toBe('false');

        fireEvent.click(row);
        expect(onToggle).toHaveBeenCalledWith('ing_lamb');
    });

    it('checked: reports checked and dims the text, with no strike-through', () => {
        render(<IngredientCheckRow ingredient={lamb} checked allRemoved={false} onToggle={vi.fn()} />);

        const row = screen.getByRole('checkbox', { name: /lamb shoulder/u });
        expect(row.getAttribute('aria-checked')).toBe('true');
        const name = screen.getByText('lamb shoulder');
        expect(getComputedStyle(name).textDecorationLine ?? '').not.toContain('line-through');
        expect(getComputedStyle(name).color).toBe(rgb(role.inkMuted));
    });

    it('unchecked: reports unchecked and keeps the text in ink', () => {
        render(<IngredientCheckRow ingredient={lamb} checked={false} allRemoved={false} onToggle={vi.fn()} />);

        expect(screen.getByRole('checkbox', { name: /lamb shoulder/u }).getAttribute('aria-checked')).toBe('false');
        expect(getComputedStyle(screen.getByText('lamb shoulder')).color).toBe(rgb(role.ink));
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
