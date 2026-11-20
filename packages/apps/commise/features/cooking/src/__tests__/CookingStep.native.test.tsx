/**
 * The native step body: a region named by the place, the step track, the collapsed record of ticked lines with Show, the
 * "Line n of N" overline (hidden for a one-line step), the focus line, the "Then" lines in reading order, and, once every
 * line is ticked, Up next. The screen decides which line is the focus and which are ticked; this leaf draws what it is
 * handed, in that order, and reports presses. The preview of the next step is not here: it is pinned in the foot.
 */
import { nativeTokens } from '@commise/ui/native';
import { render } from '@commise/ui/testing/tamagui';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CookingStep } from '../CookingStep.native.js';
import { FOCUS_LINE_TYPE } from '../focusLineType.js';
import type { CookingLineView, CookingStepProps, CookingTickedView } from '../cookingViewProps.js';

const user = userEvent.setup({ delay: null });

afterEach(cleanup);

interface Face {
    readonly fontSize: number;
}

/** A role's face; a role with one face per size class is read at its regular class, which a phone column uses. */
const faceOf = (style: Face | { readonly regular: Face }): Face => ('regular' in style ? style.regular : style);
const FOCUS_FACE = faceOf(nativeTokens.type[FOCUS_LINE_TYPE.nativeTypeRole]);
const BODY_FACE = faceOf(nativeTokens.type.readingBody);

function line(text: string, checked = false): CookingLineView {
    return { key: text, text, checked, onToggle: vi.fn() };
}

function stepProps(overrides: Partial<CookingStepProps> = {}): CookingStepProps {
    return {
        label: 'Step 2 of 4',
        track: { total: 4, position: 2 },
        lineOf: 'Line 1 of 3',
        focus: line('Heat 1.5 tbsp. oil in a wide pan.'),
        then: [line('Add the onion.'), line('Cook it for 5 min.')],
        ...overrides,
    };
}

function tickedView(overrides: Partial<CookingTickedView> = {}): CookingTickedView {
    return {
        summary: 'You ticked 1 line',
        show: { label: 'Show', onPress: vi.fn() },
        expanded: false,
        lines: [],
        ...overrides,
    };
}

describe('CookingStep (native)', () => {
    it('is a region named by the place', () => {
        render(<CookingStep {...stepProps()} />);

        expect(screen.getByRole('region', { name: 'Step 2 of 4' })).toBeTruthy();
    });

    it('draws the overline, then the focus line, then the Then lines, in that order', () => {
        render(<CookingStep {...stepProps()} />);

        const boxes = screen.getAllByRole('checkbox').map((box) => box.textContent);

        expect(screen.getByText('Line 1 of 3')).toBeTruthy();
        expect(boxes).toEqual(['Heat 1.5 tbsp. oil in a wide pan.', 'Add the onion.', 'Cook it for 5 min.']);
    });

    // A one-line step shows no "Line 1 of 1" and no Then list: a count of one says nothing.
    it('shows no overline and no Then lines for a one-line step', () => {
        render(<CookingStep {...stepProps({ lineOf: undefined, then: [] })} />);

        expect(screen.queryByText(/^Line /u)).toBeNull();
        expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    });

    it('reports a press on a line to that line', async () => {
        const props = stepProps();
        render(<CookingStep {...props} />);

        await user.click(screen.getByRole('checkbox', { name: 'Add the onion.' }));

        expect(props.then[0]?.onToggle).toHaveBeenCalledTimes(1);
        expect(props.focus?.onToggle).not.toHaveBeenCalled();
    });

    // Ticked lines collapse into one record; Show opens them, and each can be unticked from there.
    it('collapses ticked lines into the summary, and Show opens them', async () => {
        const ticked = tickedView();
        const { rerender } = render(<CookingStep {...stepProps({ ticked })} />);

        expect(screen.getByText('You ticked 1 line')).toBeTruthy();
        expect(screen.queryByRole('checkbox', { name: 'Chop the onion.' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Show' }).getAttribute('aria-expanded')).toBe('false');

        await user.click(screen.getByRole('button', { name: 'Show' }));
        expect(ticked.show.onPress).toHaveBeenCalledTimes(1);

        rerender(
            <CookingStep
                {...stepProps({ ticked: { ...ticked, expanded: true, lines: [line('Chop the onion.', true)] } })}
            />,
        );

        expect(screen.getByRole('checkbox', { name: 'Chop the onion.' }).getAttribute('aria-checked')).toBe('true');
        expect(screen.getByRole('button', { name: 'Show' }).getAttribute('aria-expanded')).toBe('true');
    });

    // Next coming: every line ticked, so there is no focus line.
    it('draws no focus line when every line is ticked', () => {
        render(
            <CookingStep
                {...stepProps({
                    lineOf: undefined,
                    focus: undefined,
                    then: [],
                    ticked: tickedView({ summary: 'You ticked 3 lines' }),
                })}
            />,
        );

        expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
        expect(screen.getByText('You ticked 3 lines')).toBeTruthy();
    });

    // Once every line is ticked the body shows Up next: its overline, the lead line in the focus line's role and the rest
    // in reading body, all plain text, never a control. Rewritten from the old `next` lines when the preview moved to the
    // foot and Up next stayed in the body.
    it('shows Up next as plain text: the lead in the focus-line role, the rest in reading body', () => {
        render(
            <CookingStep
                {...stepProps({
                    upNext: { overline: 'Up next · step 3', lead: 'Season the roast.', rest: ['Rest it.'] },
                })}
            />,
        );

        expect(screen.getByText('Up next · step 3')).toBeTruthy();
        expect(getComputedStyle(screen.getByText('Season the roast.')).fontSize).toBe(
            `${String(FOCUS_FACE.fontSize)}px`,
        );
        expect(getComputedStyle(screen.getByText('Rest it.')).fontSize).toBe(`${String(BODY_FACE.fontSize)}px`);
        expect(screen.queryByRole('checkbox', { name: 'Season the roast.' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Season the roast.' })).toBeNull();
    });

    it('shows nothing next on the last step', () => {
        render(<CookingStep {...stepProps()} />);

        expect(screen.queryByText(/next/iu)).toBeNull();
    });

    // The track is decoration: the place carries the same fact.
    it('draws one track segment per step, hidden from assistive tech', () => {
        render(<CookingStep {...stepProps()} />);

        const track = screen.getByTestId('cooking-step-track');

        expect(track.getAttribute('aria-hidden')).toBe('true');
        expect(track.children).toHaveLength(4);
    });

    it('marks the steps done, now and later in three different colours', () => {
        render(<CookingStep {...stepProps({ track: { total: 3, position: 2 } })} />);

        const [done, now, later] = Array.from(screen.getByTestId('cooking-step-track').children).map(
            (segment) => getComputedStyle(segment).backgroundColor,
        );

        expect(new Set([done, now, later]).size).toBe(3);
    });
});
