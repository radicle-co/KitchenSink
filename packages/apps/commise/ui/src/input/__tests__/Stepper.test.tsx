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

    it('draws 44px round buttons with the minus and plus glyphs and the focusRing', () => {
        render(<Servings />);

        for (const [name, glyph] of [
            ['Fewer servings', 'lucide-minus'],
            ['More servings', 'lucide-plus'],
        ] as const) {
            const button = screen.getByRole('button', { name });

            expect(button.className.split(/\s+/u)).toEqual(
                expect.arrayContaining([
                    'size-11',
                    'rounded-full',
                    'border-line-control',
                    'focus-visible:ring-focus-ring',
                ]),
            );
            expect(button.querySelector(`svg.${glyph}`)).not.toBeNull();
        }
    });
});
