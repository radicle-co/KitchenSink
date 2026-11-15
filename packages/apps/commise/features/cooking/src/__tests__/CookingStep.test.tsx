import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CookingStep } from '../CookingStep.js';
import type { CookingLineView, CookingStepProps } from '../cookingViewProps.js';
import { FOCUS_LINE_TYPE } from '../focusLineType.js';
import { htmlElementOf } from '../__fixtures__/htmlElementOf.js';

/**
 * The step body. Structure only: the region and its name, the lines as
 * checkboxes named by their text in reading order, what a one-line step hides, the ticked record and its disclosure,
 * and the next-step block. Which line is the focus, and the copy, are decided upstream and tested in CookingScreen.
 */
const line = (key: string, text: string, checked = false, onToggle = vi.fn()): CookingLineView => ({
    key,
    text,
    checked,
    onToggle,
});

function props(over: Partial<CookingStepProps> = {}): CookingStepProps {
    return {
        label: 'Step 2 of 6',
        track: { total: 6, position: 2 },
        lineOf: 'Line 1 of 3',
        focus: line('0', 'Heat 1.5 tbsp. oil.'),
        then: [line('1', 'Add the onion.'), line('2', 'Cook 5 min.')],
        ...over,
    };
}

describe('CookingStep', () => {
    it('is a region named by the place', () => {
        render(<CookingStep {...props()} />);

        expect(screen.getByRole('region', { name: 'Step 2 of 6' })).toBeTruthy();
    });

    it('draws every unticked line as a checkbox named by its text, focus first, in reading order', () => {
        render(<CookingStep {...props()} />);

        expect(screen.getAllByRole('checkbox').map((box) => box.getAttribute('aria-label'))).toEqual([
            'Heat 1.5 tbsp. oil.',
            'Add the onion.',
            'Cook 5 min.',
        ]);
    });

    it('focusLineTypeSeam: sets the focus line in the focus-line type seam, and the Then lines in readingBody', () => {
        render(<CookingStep {...props()} />);

        const focusText = screen.getByText('Heat 1.5 tbsp. oil.');
        const thenText = screen.getByText('Add the onion.');

        for (const token of FOCUS_LINE_TYPE.webClassName.split(' ')) {
            expect(focusText.className).toContain(token);
        }

        expect(thenText.className).toContain('text-reading-body');
        expect(thenText.className).not.toContain(FOCUS_LINE_TYPE.webClassName);
    });

    it('shows the line count above the focus line', () => {
        render(<CookingStep {...props()} />);

        const count = screen.getByText('Line 1 of 3');
        const focus = screen.getByRole('checkbox', { name: 'Heat 1.5 tbsp. oil.' });

        expect(count.compareDocumentPosition(focus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('hides the line count and the Then list for a one-line step', () => {
        const { container } = render(
            <CookingStep {...props({ lineOf: undefined, focus: line('0', 'Preheat the oven.'), then: [] })} />,
        );

        expect(screen.queryByText(/^Line \d/u)).toBeNull();
        expect(screen.getAllByRole('checkbox')).toHaveLength(1);
        expect(container.querySelectorAll('ul')).toHaveLength(0);
    });

    it('toggles a line through its own handler', () => {
        const onToggle = vi.fn();
        render(<CookingStep {...props({ then: [line('1', 'Add the onion.', false, onToggle)] })} />);

        fireEvent.click(screen.getByRole('checkbox', { name: 'Add the onion.' }));

        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('hides the step track from assistive technology, with one segment per step', () => {
        const { container } = render(<CookingStep {...props()} />);
        const track = container.querySelector('[data-step-track]');

        expect(track?.getAttribute('aria-hidden')).toBe('true');
        expect(track?.children).toHaveLength(6);
        expect(track?.children[1]?.className).toContain('bg-here-bar');
        expect(track?.children[0]?.className).toContain('bg-ink-muted');
        expect(track?.children[2]?.className).toContain('bg-line-divider');
    });

    describe('ticked lines', () => {
        const ticked = (expanded: boolean, onPress = vi.fn()) => ({
            summary: 'You ticked 1 line',
            show: { label: 'Show', onPress },
            expanded,
            lines: [line('0', 'Heat 1.5 tbsp. oil.', true)],
        });

        it('collapses the ticked lines behind a summary and a Show disclosure', () => {
            render(<CookingStep {...props({ ticked: ticked(false), focus: line('1', 'Add the onion.'), then: [] })} />);

            expect(screen.getByText('You ticked 1 line')).toBeTruthy();
            const show = screen.getByRole('button', { name: 'Show' });
            expect(show.getAttribute('aria-expanded')).toBe('false');
            expect(screen.queryByRole('checkbox', { name: 'Heat 1.5 tbsp. oil.' })).toBeNull();
        });

        it('opens the ticked lines as checked checkboxes the cook can untick', () => {
            const onPress = vi.fn();
            render(
                <CookingStep
                    {...props({ ticked: ticked(true, onPress), focus: line('1', 'Add the onion.'), then: [] })}
                />,
            );

            const show = screen.getByRole('button', { name: 'Show' });
            expect(show.getAttribute('aria-expanded')).toBe('true');
            expect(screen.getByRole('checkbox', { name: 'Heat 1.5 tbsp. oil.' }).getAttribute('aria-checked')).toBe(
                'true',
            );

            fireEvent.click(show);
            expect(onPress).toHaveBeenCalledTimes(1);
        });

        it('keeps the ticked record above the focus line', () => {
            render(<CookingStep {...props({ ticked: ticked(false), focus: line('1', 'Add the onion.'), then: [] })} />);

            const summary = screen.getByText('You ticked 1 line');
            const focus = screen.getByRole('checkbox', { name: 'Add the onion.' });

            expect(summary.compareDocumentPosition(focus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });

        it('puts the ticked summary above "Line n of m"', () => {
            render(
                <CookingStep
                    {...props({
                        ticked: ticked(false),
                        lineOf: 'Line 2 of 3',
                        focus: line('1', 'Add the onion.'),
                        then: [],
                    })}
                />,
            );

            const summary = screen.getByText('You ticked 1 line');
            const lineOf = screen.getByText('Line 2 of 3');

            expect(summary.compareDocumentPosition(lineOf) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });
    });

    it('marks an unticked line unchecked', () => {
        render(<CookingStep {...props()} />);

        expect(screen.getByRole('checkbox', { name: 'Add the onion.' }).getAttribute('aria-checked')).toBe('false');
    });

    describe('Up next', () => {
        const upNextProps = props({
            lineOf: undefined,
            focus: undefined,
            then: [],
            ticked: {
                summary: 'You ticked 3 lines',
                show: { label: 'Show', onPress: vi.fn() },
                expanded: false,
                lines: [],
            },
            upNext: { overline: 'Up next · step 3', lead: 'Season well.', rest: ['Serve.'] },
        });

        it('shows the next step after the summary, as plain text, never as checkboxes', () => {
            render(<CookingStep {...upNextProps} />);

            const summary = screen.getByText('You ticked 3 lines');
            const overline = screen.getByText('Up next · step 3');
            const block = htmlElementOf(overline.parentElement);

            expect(summary.compareDocumentPosition(overline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(within(block).getByText('Season well.')).toBeTruthy();
            expect(within(block).getByText('Serve.')).toBeTruthy();
            expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
        });

        it('sets the next step’s first line at the focus size and its other lines at the reading size', () => {
            render(<CookingStep {...upNextProps} />);

            expect(screen.getByText('Season well.').className).toContain(FOCUS_LINE_TYPE.webClassName);
            expect(screen.getByText('Serve.').className).toContain('text-reading-body');
            expect(screen.getByText('Serve.').className).not.toContain(FOCUS_LINE_TYPE.webClassName);
        });

        it('draws no Up next, and no preview, while it is absent', () => {
            render(<CookingStep {...props()} />);

            expect(screen.queryByText(/step 3/iu)).toBeNull();
        });
    });
});
