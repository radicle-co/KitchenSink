import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { Platform } from 'react-native';
import { useState } from 'react';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { Stepper } from '../Stepper.native.js';
import type { StepperProps } from '../props.js';

/**
 * Stepper (native) — `[−] value [+]`, buttons 44 pt on iOS and 48 dp on Android, the value in tabular digits, the new
 * value announced politely through `@commise/ui/live-region`, and a button at its bound disabled.
 */

afterEach(cleanup);

function onPlatform(os: 'ios' | 'android'): () => void {
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

    return () => Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
}

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

describe('Stepper (native)', () => {
    it('is a group named by its label, with the value in tabular digits', () => {
        render(<Servings />);

        const group = screen.getByRole('group', { name: 'Servings' });

        expect(getComputedStyle(within(group).getByText('2')).fontVariant).toContain('tabular-nums');
    });

    it('steps the value up and down', () => {
        render(<Servings />);

        fireEvent.click(screen.getByRole('button', { name: 'More servings' }));
        expect(screen.getByText('3')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Fewer servings' }));
        expect(screen.getByText('2')).toBeTruthy();
    });

    it('announces the new value after a press, and nothing before', () => {
        const { container } = render(<Servings />);
        const spoken = (): string =>
            [...container.querySelectorAll('[aria-live="polite"]')].map((region) => region.textContent).join('');

        expect(spoken()).toBe('');

        fireEvent.click(screen.getByRole('button', { name: 'More servings' }));

        expect(spoken()).toBe('Serves 3');
    });

    it('disables the − button at the minimum of 1, and does not step', () => {
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
        fireEvent.click(fewer);

        expect(fewer.getAttribute('aria-disabled')).toBe('true');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('disables the + button at a maximum', () => {
        render(
            <Stepper
                id="s"
                label="Servings"
                value={4}
                max={4}
                onChange={vi.fn()}
                announce={String}
                decreaseLabel="Fewer servings"
                increaseLabel="More servings"
            />,
        );

        expect(screen.getByRole('button', { name: 'More servings' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('sizes each button at 44pt on iOS and 48dp on Android, drawing minus and plus', () => {
        for (const [os, size] of [
            ['ios', '44px'],
            ['android', '48px'],
        ] as const) {
            const restore = onPlatform(os);

            try {
                const { unmount } = render(<Servings />);

                for (const [name, glyph] of [
                    ['Fewer servings', 'minus'],
                    ['More servings', 'plus'],
                ] as const) {
                    const button = screen.getByRole('button', { name });

                    expect(getComputedStyle(button).minWidth, `${os} ${name}`).toBe(size);
                    expect(getComputedStyle(button).minHeight, `${os} ${name}`).toBe(size);
                    expect(button.querySelector<HTMLElement>('[data-commise-stub="icon"]')?.dataset['iconName']).toBe(
                        glyph,
                    );
                }

                unmount();
            } finally {
                restore();
            }
        }
    });
});
