/**
 * The design-system `OptionLabel` (web): the label of one option in a list of choices — its name, a quiet tag after it
 * ("Default", owner ruling 2026-10-25) and a variant's parts under it. Extracted when the same tagged label was drawn
 * four times (the Combobox's two leaves and the food-choice list's two), so the four can no longer drift.
 *
 * - Display only: it names nothing and presses nothing. The option around it owns the role, the name and the press.
 * - The tag FOLLOWS the label and wraps under it at 320 px; the label can shrink below its longest word (`min-w-0`) and
 *   breaks rather than pushing the row sideways.
 * - Its size is the caller's, from a closed pair: a combobox option matches the field the cook types in (`bodyMd`);
 *   a list of ingredient lines takes the 14 px `list` role (owner type-scale ruling 2026-10-25). The parts line is 14 px
 *   at either size: never larger than a list line, and one step under a combobox option.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { OptionLabel } from '../OptionLabel.js';

afterEach(cleanup);

describe('OptionLabel (web)', () => {
    it('draws the label alone when it has no tag and no parts', () => {
        const { container } = render(<OptionLabel label="Skim milk" textSize="list" />);

        expect(screen.getByText('Skim milk')).toBeTruthy();
        expect(container.textContent).toBe('Skim milk');
    });

    it('draws the tag AFTER the label, as a badge', () => {
        const { container } = render(<OptionLabel label="Whole milk" tag="Default" textSize="list" />);

        expect(container.textContent).toBe('Whole milkDefault');
        expect(screen.getByText('Default')).toBeTruthy();
    });

    it('draws a variant’s parts under the label', () => {
        render(<OptionLabel label="Oat milk" detailParts={['unsweetened']} textSize="list" />);

        expect(screen.getByText('unsweetened')).toBeTruthy();
    });

    it('a tagged label keeps its parts', () => {
        const { container } = render(
            <OptionLabel label="Oat milk" tag="Default" detailParts={['unsweetened']} textSize="list" />,
        );

        expect(container.textContent).toBe('Oat milkDefaultunsweetened');
    });

    it('is display only: no control, no role of its own', () => {
        const { container } = render(<OptionLabel label="Whole milk" tag="Default" textSize="list" />);

        expect(screen.queryByRole('button')).toBeNull();
        expect(container.querySelector('[role]')).toBeNull();
    });

    it.each([
        ['list', 'text-list'],
        ['bodyMd', 'text-body-md'],
    ] as const)('textSize %s draws the label in %s', (textSize, utility) => {
        render(<OptionLabel label="Whole milk" tag="Default" textSize={textSize} />);

        expect(screen.getByText('Whole milk').className).toContain(utility);
    });

    it.each(['list', 'bodyMd'] as const)('textSize %s draws the variant’s parts at 14 px (body-sm)', (textSize) => {
        render(<OptionLabel label="Oat milk" detailParts={['unsweetened']} textSize={textSize} />);

        expect(screen.getByText('unsweetened').closest('span.break-words')?.className).toContain('text-body-sm');
    });

    it('⛔ wraps at 320 px: the label can shrink below its longest word and breaks, and the tag wraps under it', () => {
        render(<OptionLabel label="Milk, fluid, 3.25% milkfat, with added vitamin D" tag="Default" textSize="list" />);

        const label = screen.getByText('Milk, fluid, 3.25% milkfat, with added vitamin D');

        expect(label.className).toContain('min-w-0');
        expect(label.className).toContain('break-words');
        expect(label.parentElement?.className).toContain('flex-wrap');
        expect(label.parentElement?.parentElement?.className).toContain('min-w-0');
    });
});
