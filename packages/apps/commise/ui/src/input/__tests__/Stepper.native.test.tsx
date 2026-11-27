import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { useState, type ReactElement } from 'react';

import { Text } from '../../text/Text.native.js';
import { present } from '../../testing/present.js';
import { withPlatformOs } from '../../testing/platformOs.native.js';
import { renderWithTamagui, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import { nativeTokens } from '../../tokens/native.js';
import { dimmedOpacity } from '../../tokens/scale.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { Stepper } from '../Stepper.native.js';
import type { StepperProps } from '../props.js';

/**
 * Stepper (native) — `[−] value [+]`, buttons 44 pt on iOS and 48 dp on Android, the value in tabular digits, the new
 * value announced politely through `@commise/ui/live-region`, and a button at its bound disabled.
 */

/**
 * The frame layer of a step button: the one bordered element in the button's seat (the nearest ancestor of the button
 * that holds one outside the button). It throws when there is none or more than one, when the seat holds the other
 * button, and when the frame is the button, inside it or around it.
 */
function frameOf(button: HTMLElement, other: HTMLElement): HTMLElement {
    let seat = button.parentElement;

    while (seat !== null) {
        const framed = Array.from(seat.querySelectorAll<HTMLElement>('*')).filter(
            (candidate) => !button.contains(candidate) && getComputedStyle(candidate).borderTopWidth === '1px',
        );

        if (framed.length > 0) {
            const [frame] = framed;

            if (framed.length !== 1 || frame === undefined || seat.contains(other) || frame.contains(button)) {
                throw new Error('The step button seat is not one button and one frame layer.');
            }

            return frame;
        }

        seat = seat.parentElement;
    }

    throw new Error('The step button has no frame layer.');
}

afterEach(cleanup);

// The count and the label are the house `Text`, which needs the design system's provider.
const render = (ui: ReactElement) => renderWithTamagui(ui, 'light');

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
    // The count is the house `figureInline` text (body face, semibold, with figures) inside a body line. jsdom drops the `font-variant` rule but
    // keeps the atomic `_fv-` class Tamagui writes for it, so the class is the evidence the count asked for them.
    it('is a group named by its label, with the value in tabular digits', () => {
        render(<Servings />);

        const group = screen.getByRole('group', { name: 'Servings' });

        const fontVariantClass = (element: HTMLElement): string | undefined =>
            element.className.split(' ').find((name) => name.startsWith('_fv-'));
        const count = within(group).getByText('2');

        // The class is hashed per value, so equality with a house `figureInline` text (pinned in Text.native.test.tsx) proves the count's digits, not just that it set some font variant.
        renderWithTamagui(<Text typeRole="figureInline">ref</Text>, 'light');

        expect(fontVariantClass(count)).toBeDefined();
        expect(fontVariantClass(count)).toBe(fontVariantClass(screen.getByText('ref')));
    });

    // The face IS the weight on native, so the count's semibold is its `figureInline` font family.
    // `resolvedStyle` returns the bare family, so `toBe` holds; a count that fell back to the body face fails it.
    it('draws the count in the semibold figure face', () => {
        render(<Servings />);

        const count = within(screen.getByRole('group', { name: 'Servings' })).getByText('2');

        expect(resolvedStyle(count, 'fontFamily')).toBe(nativeTokens.type.figureInline.fontFamily);
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

    // Rewritten: the button is the shared icon button over the stepper's own frame layer in one seat, so the size
    // is read on that frame layer and on the button's own frame.
    it.each([
        ['ios', '44px'],
        ['android', '48px'],
    ] as const)('sizes each framed button at the touch floor on %s, drawing minus and plus', (os, size) => {
        withPlatformOs(os, () => {
            render(<Servings />);

            for (const [name, glyph, other] of [
                ['Fewer servings', 'minus', 'More servings'],
                ['More servings', 'plus', 'Fewer servings'],
            ] as const) {
                const button = screen.getByRole('button', { name });
                const frame = frameOf(button, screen.getByRole('button', { name: other }));
                const inner = present(button.firstElementChild, `the ${name} frame`);

                expect(getComputedStyle(frame).width, `${os} ${name}`).toBe(size);
                expect(getComputedStyle(frame).height, `${os} ${name}`).toBe(size);
                expect(getComputedStyle(inner).width, `${os} ${name}`).toBe(size);
                expect(getComputedStyle(inner).height, `${os} ${name}`).toBe(size);
                expect(button.querySelector<HTMLElement>('[data-commise-stub="icon"]')?.dataset['iconName']).toBe(
                    glyph,
                );
            }
        });
    });

    // New: the whole control dims once at a bound. The frame layer goes to 40% and the icon button's own circle
    // goes to 40%, neither inside the other. Its live neighbour dims neither.
    it('dims the frame and the icon button once each at a bound, and neither at a live value', () => {
        render(<Servings initial={1} />);
        const fewer = screen.getByRole('button', { name: 'Fewer servings' });
        const more = screen.getByRole('button', { name: 'More servings' });
        const circleOf = (button: HTMLElement): Element =>
            present(button.firstElementChild?.firstElementChild, 'the circle');
        const dimmed = String(dimmedOpacity);

        expect(getComputedStyle(frameOf(fewer, more)).opacity).toBe(dimmed);
        expect(getComputedStyle(circleOf(fewer)).opacity).toBe(dimmed);
        expect(getComputedStyle(frameOf(more, fewer)).opacity).not.toBe(dimmed);
        expect(getComputedStyle(circleOf(more)).opacity).not.toBe(dimmed);
    });

    // Pins the row's 8 gap and the count's 24 minimum width, as inline styles that jsdom reads. It does not check the
    // three-digit widening.
    it('keeps its row narrow enough for 320 at the largest text: an 8 gap and a 24 minimum count width', () => {
        render(<Servings />);

        const group = screen.getByRole('group', { name: 'Servings' });
        // The digit is an inline `figureInline` run inside the sized `body` Text, and only that outer box takes a width.
        const count = within(group).getByText('2').parentElement;

        if (count === null) {
            throw new Error('The count has no outer box');
        }

        expect(getComputedStyle(group).gap).toBe('8px');
        expect(getComputedStyle(count).minWidth).toBe('24px');
        expect(getComputedStyle(count).width).toBe('auto');
        expect(getComputedStyle(count).maxWidth).toBe('none');
    });

    // The recipe page puts the Stepper in the Ingredients heading row beside "for {n}" (`buildSpec.md` §6.1), where a
    // visible label would say the same thing twice. Hidden from sight, the label still names the group.
    it('can hide its label from sight while it still names the group', () => {
        render(<Servings labelVisibility="hidden" />);

        const label = screen.getByText('Servings');

        expect(screen.getByRole('group', { name: 'Servings' })).toBeTruthy();
        expect(getComputedStyle(label).position === 'absolute' && getComputedStyle(label).width === '1px').toBe(true);
    });
});
