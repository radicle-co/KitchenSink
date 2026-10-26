/**
 * The design-system `OptionLabel` (native): the React Native leaf of `../OptionLabel.tsx`, on the same props. A View
 * holding the label `Text`, the `note` badge after it and the parts line under it, so the badge keeps its own radius and
 * padding (a nested `Text` takes neither reliably).
 *
 * - Display only: it presses nothing and has no role. The option around it owns the role, the name and the press.
 * - At 320 pt the tag wraps under the label (`flexWrap`), and the label can shrink (`flexShrink: 1`, `minWidth: 0`), so
 *   nothing is cut off or pushes the row sideways.
 * - `list` draws the 13 px `list` role's face, size and leading; `bodyMd` the combobox's field-matching size.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { nativeTokens } from '../../tokens/native.js';
import { OptionLabel } from '../OptionLabel.native.js';

afterEach(cleanup);

describe('OptionLabel (native)', () => {
    it('draws the label alone when it has no tag and no parts', () => {
        const { container } = render(<OptionLabel label="Skim milk" textSize="list" />);

        expect(container.textContent).toBe('Skim milk');
    });

    it('draws the tag AFTER the label', () => {
        const { container } = render(<OptionLabel label="Whole milk" tag="Default" textSize="list" />);

        expect(container.textContent).toBe('Whole milkDefault');
    });

    it('a tagged label keeps its parts, under it', () => {
        const { container } = render(
            <OptionLabel label="Oat milk" tag="Default" detailParts={['unsweetened']} textSize="list" />,
        );

        expect(container.textContent).toBe('Oat milkDefaultunsweetened');
    });

    it('is display only: no control and no role', () => {
        const { container } = render(<OptionLabel label="Whole milk" tag="Default" textSize="list" />);

        expect(screen.queryByRole('button')).toBeNull();
        expect(container.querySelector('[role]')).toBeNull();
    });

    it('`list` draws the list role’s size and leading', () => {
        render(<OptionLabel label="Whole milk" textSize="list" />);

        const label = getComputedStyle(screen.getByText('Whole milk'));

        expect(label.fontSize).toBe(`${String(nativeTokens.type.list.fontSize)}px`);
        expect(label.lineHeight).toBe(`${String(nativeTokens.type.list.lineHeight)}px`);
    });

    it('`bodyMd` draws the combobox’s field-matching size', () => {
        render(<OptionLabel label="Whole milk" textSize="bodyMd" />);

        expect(getComputedStyle(screen.getByText('Whole milk')).fontSize).toBe(
            `${String(nativeTokens.fontSize.bodyMd)}px`,
        );
    });

    it('⛔ wraps at 320 pt: the tag wraps under the label, and the label can shrink', () => {
        render(<OptionLabel label="Milk, fluid, 3.25% milkfat, with added vitamin D" tag="Default" textSize="list" />);

        const label = screen.getByText('Milk, fluid, 3.25% milkfat, with added vitamin D');
        const nameLine = label.parentElement;

        expect(getComputedStyle(label).flexShrink).toBe('1');
        expect(getComputedStyle(label).minWidth).toBe('0px');
        expect(nameLine === null ? undefined : getComputedStyle(nameLine).flexWrap).toBe('wrap');
    });
});
