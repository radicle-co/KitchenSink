/**
 * `DurationField` (native, react-native-web under jsdom): a duration stored in SECONDS, entered as hours and minutes (F1/I3,
 * `docs/design/uiOverhaul/specRecipeAndWizard.md` S0.4). The step timer used to be one number box that took seconds,
 * so a cook typed "16200" for four and a half hours.
 *
 * The contract: it shows the stored value split into hours and minutes, it reports every edit as seconds, an empty
 * field is "no duration" (never a "0"), and each box has its own accessible name inside one labelled group.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ fontScale: 1 }));

// The system text size (Android font scale, iOS Dynamic Type). react-native-web always answers 1.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        useWindowDimensions: () => ({ ...actual.useWindowDimensions(), fontScale: env.fontScale }),
    };
});

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { role } from '../../tokens/colors.js';
import { DurationField } from '../DurationField.native.js';
import type { DurationFieldProps } from '../props.js';

afterEach(() => {
    cleanup();
    env.fontScale = 1;
});

function renderField(overrides: Partial<DurationFieldProps> = {}) {
    const onChange = vi.fn();
    render(
        <DurationField
            label="Timer (optional)"
            hoursLabel="Step 1 timer, hours"
            minutesLabel="Step 1 timer, minutes"
            hoursUnit="h"
            minutesUnit="min"
            value={undefined}
            onChange={onChange}
            {...overrides}
        />,
    );

    return onChange;
}

// react-native-web renders a numeric `TextInput` as a text input, so the boxes are found by their names.
const hours = (): HTMLInputElement => screen.getByLabelText<HTMLInputElement>('Step 1 timer, hours');
const minutes = (): HTMLInputElement => screen.getByLabelText<HTMLInputElement>('Step 1 timer, minutes');

describe('DurationField (native) — a 136 px cell (A-009)', () => {
    // A-009 (build spec §7.4: "below 600, Prep and Cook sit side by side, about 136 px each at 320"): two boxes at a fixed
    // 80 dp plus their units are about 220 dp, which wrapped Cook onto its own line. The boxes give back padding so a
    // two-digit number fits a narrower box.
    it('fits a 136 dp cell: no 80 dp box, and the tighter number padding', () => {
        renderField();

        for (const box of [hours(), minutes()]) {
            const style = getComputedStyle(box);

            expect(style.width).not.toBe('80px');
            expect(style.paddingLeft).toBe('8px');
        }
    });

    // Owner, the step timer on a phone: "the input for hour and minute ... are too skinny. They need to support at
    // least two digits." Rewritten twice: `minWidth: 0` let a box collapse to one character, and then `flex: 1` with a
    // least width stretched each box across the row on the emulator, the hours box wider than the minutes box.
    it('gives both boxes one width, never stretched: two widest digits at the body size, padding, edges and caret room', () => {
        renderField();

        for (const box of [hours(), minutes()]) {
            const style = getComputedStyle(box);

            expect(style.width).toBe('42.8px');
            expect(style.flexGrow).not.toBe('1');
        }
    });

    it('grows that width with the system text size, so two digits still fit at 200%', () => {
        env.fontScale = 2;
        renderField();

        for (const box of [hours(), minutes()]) {
            expect(getComputedStyle(box).width).toBe('63.6px');
        }
    });

    // At 200% text the two pairs no longer fit a 136 dp cell, so the minutes pair moves under the hours pair whole: a
    // unit never parts from its box, and nothing scrolls sideways.
    it('keeps each box with its unit, and wraps the minutes pair under the hours pair only when they do not fit', () => {
        renderField();

        const hoursPair = hours().parentElement as HTMLElement;
        const minutesPair = minutes().parentElement as HTMLElement;

        expect(hoursPair).toBe(screen.getByText('h').parentElement);
        expect(minutesPair).toBe(screen.getByText('min').parentElement);
        expect(hoursPair.parentElement).toBe(minutesPair.parentElement);
        expect(getComputedStyle(hoursPair.parentElement as HTMLElement).flexWrap).toBe('wrap');

        // Each pair takes only its own width, so the row wraps only when the two pairs do not fit side by side.
        for (const pair of [hoursPair, minutesPair]) {
            expect(getComputedStyle(pair).flexGrow).not.toBe('1');
        }
    });
});

describe('DurationField (native)', () => {
    // REWRITTEN (nativeContainerNames.md N1): the visible label names the field, so the wrapping View carries no
    // second name and no `group` role that would make a screen reader say the label twice. Each box names itself.
    it('shows its label once, as text, with no named group around it', () => {
        renderField();

        expect(screen.getByText('Timer (optional)')).toBeTruthy();
        expect(screen.queryByRole('group')).toBeNull();
        expect(screen.queryAllByLabelText('Timer (optional)')).toHaveLength(0);
    });

    it('shows a stored duration as hours and minutes', () => {
        renderField({ value: 16200 });

        expect(hours().value).toBe('4');
        expect(minutes().value).toBe('30');
    });

    it('shows no duration as two EMPTY boxes, never a 0', () => {
        renderField({ value: undefined });

        expect(hours().value).toBe('');
        expect(minutes().value).toBe('');
    });

    it('leaves the hours box empty for a duration under an hour, and the minutes box empty on a whole hour', () => {
        renderField({ value: 1200 });
        expect(hours().value).toBe('');
        expect(minutes().value).toBe('20');
        cleanup();

        renderField({ value: 7200 });
        expect(hours().value).toBe('2');
        expect(minutes().value).toBe('');
    });

    it('reports an edit to either box as the whole duration in seconds', () => {
        const onChange = renderField({ value: 1800 });

        fireEvent.change(hours(), { target: { value: '4' } });
        expect(onChange).toHaveBeenLastCalledWith(16200);

        fireEvent.change(minutes(), { target: { value: '45' } });
        expect(onChange).toHaveBeenLastCalledWith(2700);
    });

    it('reports clearing the last non-empty box as no duration', () => {
        const onChange = renderField({ value: 1200 });

        fireEvent.change(minutes(), { target: { value: '' } });

        expect(onChange).toHaveBeenLastCalledWith(undefined);
    });

    it('treats an unreadable or negative entry as zero rather than storing it', () => {
        const onChange = renderField({ value: 3600 });

        fireEvent.change(minutes(), { target: { value: '-5' } });

        expect(onChange).toHaveBeenLastCalledWith(3600);
    });

    it('shows each unit beside its box without adding it to the box’s name', () => {
        renderField();

        expect(screen.getByText('h').getAttribute('aria-hidden')).toBe('true');
        expect(screen.getByText('min').getAttribute('aria-hidden')).toBe('true');
        expect(hours().getAttribute('inputmode')).toBe('numeric');
    });

    // UI-overhaul slice 2: the boxes take the Input rules (`fieldStyle.ts`) rather than a geometry of their own.
    it('draws each box on the shared field geometry: 12 radius, a lineControl edge, 48 tall', () => {
        renderField();

        for (const box of [hours(), minutes()]) {
            const style = getComputedStyle(box);

            expect(style.borderTopLeftRadius).toBe('12px');
            expect(style.borderTopColor).toBe(rgb(role.lineControl));
            expect(style.minHeight).toBe('48px');
        }
    });
});

/** `#RRGGBB` → jsdom's `rgb(r, g, b)`. */
function rgb(hex: string): string {
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

    return `rgb(${r}, ${g}, ${b})`;
}
