// @vitest-environment jsdom
/**
 * The design-system `ChoiceRow` (web): one row of a list of choices whose press IS the choice — a food a matched
 * ingredient line could be, or "Keep … as written" (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`).
 *
 * - A BUTTON, never a radio: its press is the pick, and arrow keys do nothing.
 * - A row that is chosen draws a check; a row whose send is in flight draws a spinner and reads busy (staff-ux H2); a
 *   row refused because a sibling's send is in flight stays focusable and refuses the press (WCAG 2.2 SC 2.4.3).
 *   Busy and refused rows take the house dim (`BUSY_CONTROL_CLASS`).
 * - It takes a host's focus request, so focus can land on it when there is no Search to take it (H1).
 * - 48 px tall at least, and its label is the caller's (a Slot), so a food and the quiet keep row share one row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';

import { BUSY_CONTROL_CLASS } from '../../button/busyControlProps.js';
import { ChoiceRow } from '../ChoiceRow.js';

afterEach(cleanup);

type Props = ComponentProps<typeof ChoiceRow>;

function renderRow(props: Partial<Props> = {}) {
    const onPress = vi.fn();
    const result = render(
        <ChoiceRow
            accessibilityLabel="Whole milk, Default"
            chosen={false}
            busy={false}
            refused={false}
            onPress={onPress}
            {...props}
        >
            <span>Whole milk</span>
        </ChoiceRow>,
    );

    return { onPress, row: screen.getByRole('button', { name: 'Whole milk, Default' }), ...result };
}

describe('ChoiceRow (web)', () => {
    it('is a button named by its accessible name, whose press is the choice', () => {
        const { onPress, row } = renderRow();

        fireEvent.click(row);

        expect(row.getAttribute('type')).toBe('button');
        expect(row.textContent).toBe('Whole milk');
        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('⛔ arrow keys never press it', async () => {
        const user = userEvent.setup();
        const { onPress, row } = renderRow();

        row.focus();
        await user.keyboard('{ArrowDown}{ArrowUp}');

        expect(onPress).not.toHaveBeenCalled();
    });

    it('draws nothing after the label at rest, and a check when chosen', () => {
        const { container, rerender, onPress } = renderRow();

        expect(container.querySelector('svg')).toBeNull();

        rerender(
            <ChoiceRow accessibilityLabel="Whole milk, Default" chosen busy={false} refused={false} onPress={onPress}>
                <span>Whole milk</span>
            </ChoiceRow>,
        );

        expect(container.querySelectorAll('svg')).toHaveLength(1);
        expect(container.querySelector('.animate-spin')).toBeNull();
    });

    it('⛔ busy: a spinner, aria-busy, focus kept and the press refused, with the house dim', () => {
        const { onPress, row } = renderRow({ busy: true });

        row.focus();
        fireEvent.click(row);

        expect(row.getAttribute('aria-busy')).toBe('true');
        expect(row.getAttribute('aria-disabled')).toBe('true');
        expect(row.hasAttribute('disabled')).toBe(false);
        expect(row.querySelector('.animate-spin')).not.toBeNull();
        expect(row.className).toContain(BUSY_CONTROL_CLASS);
        expect(document.activeElement).toBe(row);
        expect(onPress).not.toHaveBeenCalled();
    });

    it('⛔ refused: focus kept and the press refused, with no busy claim and no spinner', () => {
        const { onPress, row } = renderRow({ refused: true });

        row.focus();
        fireEvent.click(row);

        expect(row.getAttribute('aria-disabled')).toBe('true');
        expect(row.hasAttribute('aria-busy')).toBe(false);
        expect(row.hasAttribute('disabled')).toBe(false);
        expect(row.querySelector('.animate-spin')).toBeNull();
        expect(document.activeElement).toBe(row);
        expect(onPress).not.toHaveBeenCalled();
    });

    it('takes a requested focus once, and acknowledges it', () => {
        const handled = vi.fn();
        const { rerender, row, onPress } = renderRow({ focusRequested: false, onFocusRequestHandled: handled });

        expect(document.activeElement).not.toBe(row);

        const raised = (
            <ChoiceRow
                accessibilityLabel="Whole milk, Default"
                chosen={false}
                busy={false}
                refused={false}
                onPress={onPress}
                focusRequested
                onFocusRequestHandled={handled}
            >
                <span>Whole milk</span>
            </ChoiceRow>
        );

        rerender(raised);
        rerender(raised);

        expect(document.activeElement).toBe(row);
        expect(handled).toHaveBeenCalledTimes(1);
    });

    it('stands at the 48 px floor across the list, its words starting at the edge', () => {
        const { row } = renderRow();

        expect(row.className).toContain('min-h-12');
        expect(row.className).toContain('w-full');
        expect(row.className).toContain('text-start');
    });
});
