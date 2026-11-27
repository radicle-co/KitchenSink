import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { Stepper } from '../Stepper.js';
import type { StepperProps } from '../props.js';

/**
 * Stepper (web) — spec §1.11: `[−] value [+]`, 44 px buttons, the value in `figure` digits, `min` 1, and the new value
 * announced politely. At a bound the button refuses the press but KEEPS focus (`aria-disabled`, not `disabled`): the
 * focused control is the one just pressed, and a browser drops focus from a natively disabled one (SC 2.4.3).
 */

afterEach(cleanup);

function Servings(props: Partial<StepperProps> & { readonly initial?: number }) {
    const [value, setValue] = useState(props.initial ?? 2);

    return (
        <Stepper
            id="servings"
            label="Servings"
            value={value}
            onChange={setValue}
            announce={(n) => `Serves ${String(n)}`}
            decreaseLabel="Fewer servings"
            increaseLabel="More servings"
            {...props}
        />
    );
}

describe('Stepper (web)', () => {
    it('is a group named by its label, showing the value in tabular digits', () => {
        render(<Servings />);

        const group = screen.getByRole('group', { name: 'Servings' });

        expect(within(group).getByText('2').className).toContain('tabular-nums');
    });

    it('steps the value up and down', async () => {
        const user = userEvent.setup();
        render(<Servings />);

        await user.click(screen.getByRole('button', { name: 'More servings' }));
        expect(screen.getByText('3')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Fewer servings' }));
        expect(screen.getByText('2')).toBeTruthy();
    });

    it('announces the new value politely after a press, and says nothing on first render', async () => {
        const user = userEvent.setup();
        render(<Servings />);

        expect(
            screen
                .getAllByRole('status')
                .map((region) => region.textContent)
                .join(''),
        ).toBe('');

        await user.click(screen.getByRole('button', { name: 'More servings' }));

        expect(
            screen
                .getAllByRole('status')
                .map((region) => region.textContent)
                .join(''),
        ).toBe('Serves 3');
    });

    it('refuses to go below the minimum of 1, keeping focus on the button', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(
            <Stepper
                id="s"
                label="Servings"
                value={1}
                onChange={onChange}
                announce={String}
                decreaseLabel="Fewer servings"
                increaseLabel="More servings"
            />,
        );

        const fewer = screen.getByRole('button', { name: 'Fewer servings' });

        expect(fewer.getAttribute('aria-disabled')).toBe('true');
        expect((fewer as HTMLButtonElement).disabled).toBe(false);

        await user.click(fewer);

        expect(onChange).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(fewer);
    });

    it('refuses to go above a maximum', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(
            <Stepper
                id="s"
                label="Servings"
                value={4}
                max={4}
                onChange={onChange}
                announce={String}
                decreaseLabel="Fewer servings"
                increaseLabel="More servings"
            />,
        );

        await user.click(screen.getByRole('button', { name: 'More servings' }));

        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'More servings' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('honours a minimum other than 1', () => {
        render(
            <Stepper
                id="s"
                label="Steps"
                value={0}
                min={0}
                onChange={vi.fn()}
                announce={String}
                decreaseLabel="Fewer"
                increaseLabel="More"
            />,
        );

        expect(screen.getByRole('button', { name: 'Fewer' }).getAttribute('aria-disabled')).toBe('true');
    });

    // TEST-CHANGE (decisions/0118 addendum 5): the button is the shared icon button inside the stepper's own frame, so
    // the focus ring and the glyph are on the button and the 44 px size, the round shape, the paper fill and the control
    // line are on the frame around it.
    it('draws 44px round framed buttons with the minus and plus glyphs and the focusRing', () => {
        render(<Servings />);

        for (const [name, glyph, other] of [
            ['Fewer servings', 'lucide-minus', 'More servings'],
            ['More servings', 'lucide-plus', 'Fewer servings'],
        ] as const) {
            const button = screen.getByRole('button', { name });
            let frame = button.parentElement;

            while (frame !== null && !frame.className.split(/\s+/u).includes('border-line-control')) {
                frame = frame.parentElement;
            }

            if (frame === null) {
                throw new Error(`${name} has no framed ancestor.`);
            }

            expect(button.className.split(/\s+/u)).toContain('focus-visible:ring-focus-ring');
            expect(button.querySelector(`svg.${glyph}`)).not.toBeNull();
            expect(frame.className.split(/\s+/u)).toEqual(
                expect.arrayContaining(['size-[44px]', 'rounded-full', 'bg-paper']),
            );
            expect(frame.contains(screen.getByRole('button', { name: other }))).toBe(false);
        }
    });

    // The row must fit 320 px at 200% text: the gap is 2, the count's MINIMUM width is 1.5rem (a minimum, so a
    // three-digit count still widens it), and the buttons are a fixed 44 px for the touch target. jsdom lays nothing out,
    // so this pins the values only.
    it('keeps its row narrow enough for 320 px at 200% text: gap-2, a min-w-6 count, and 44 px buttons', () => {
        render(<Servings />);

        const group = screen.getByRole('group', { name: 'Servings' });
        const count = within(group).getByText('2');

        expect(group.className.split(/\s+/u)).toContain('gap-2');
        expect(group.className.split(/\s+/u)).not.toContain('gap-3');
        expect(count.className.split(/\s+/u)).toContain('min-w-6');
        expect(count.className.split(/\s+/u)).not.toContain('min-w-8');
        expect(count.className.split(/\s+/u).some((token) => /^(w|max-w)-/u.test(token))).toBe(false);
        // A fixed 44 CSS px circle, not rem: at 200% text the rem `size-11` grew to 88 px.
        const moreClasses = screen.getByRole('button', { name: 'More servings' }).className.split(/\s+/u);

        expect(moreClasses).toContain('size-[44px]');
        expect(moreClasses).not.toContain('size-11');
    });

    // The recipe page puts the Stepper in the Ingredients heading row beside "for {n}" (`buildSpec.md` §6.1), where a
    // visible label would say the same thing twice. Hidden from sight, the label still names the group.
    it('can hide its label from sight while it still names the group', () => {
        render(<Servings labelVisibility="hidden" />);

        const label = screen.getByText('Servings');

        expect(screen.getByRole('group', { name: 'Servings' })).toBeTruthy();
        expect(label.className.split(' ').includes('sr-only')).toBe(true);
    });
});
