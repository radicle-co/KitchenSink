/**
 * `DurationField` (web): a duration stored in SECONDS, entered as hours and minutes (F1/I3,
 * `docs/design/uiOverhaul/specRecipeAndWizard.md` S0.4). The step timer used to be one number box that took seconds,
 * so a cook typed "16200" for four and a half hours.
 *
 * The contract: it shows the stored value split into hours and minutes, it reports every edit as seconds, an empty
 * field is "no duration" (never a "0"), and each box has its own accessible name inside one labelled group.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FIELD_CLASS } from '../../input/fieldClass.js';
import { DurationField } from '../DurationField.js';
import type { DurationFieldProps } from '../props.js';

afterEach(cleanup);

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

const hours = (): HTMLInputElement => screen.getByRole('spinbutton', { name: 'Step 1 timer, hours' });
const minutes = (): HTMLInputElement => screen.getByRole('spinbutton', { name: 'Step 1 timer, minutes' });

describe('DurationField (web)', () => {
    it('is one group named by its visible label', () => {
        renderField();

        expect(screen.getByRole('group', { name: 'Timer (optional)' })).toBeTruthy();
        expect(screen.getByText('Timer (optional)')).toBeTruthy();
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
    });

    // A-009 (build spec §7.4: "below 600, Prep and Cook sit side by side, about 136 px each at 320"): two boxes at a
    // fixed 80 px plus their units are about 220 px, which wrapped Cook onto its own line. The boxes share the room
    // the cell gives them instead, and give back padding so a two-digit number still fits in 136 px.
    it('fits a 136 px cell: the boxes have no fixed width and share the room, with the tighter number padding', () => {
        renderField();

        for (const box of [hours(), minutes()]) {
            const classes = box.className.split(/\s+/u);

            expect(classes).not.toContain('w-20');
            expect(classes).toEqual(expect.arrayContaining(['flex-1', 'px-2!']));
        }
    });

    // Owner, the step timer on a phone: "the input for hour and minute ... are too skinny. They need to support at
    // least two digits." Rewritten from `min-w-0`, which let a box in an auto-width row collapse to one character.
    it('never narrows a box below two of the face’s widest digit, in em so it grows with the text', () => {
        renderField();

        for (const box of [hours(), minutes()]) {
            // jsdom reorders a `calc()` sum, so the terms are compared as a set.
            const terms = box.style.minWidth
                .replace(/^calc\((.*)\)$/u, '$1')
                .split(' + ')
                .sort();

            expect(terms).toEqual(['1.3em', '1rem', '2px']);
            expect(box.className.split(/\s+/u)).not.toContain('min-w-0');
        }
    });

    it('draws no spin buttons, which would take the digits’ room and are too small to tap', () => {
        renderField();

        for (const box of [hours(), minutes()]) {
            expect(box.className.split(/\s+/u)).toEqual(
                expect.arrayContaining([
                    '[appearance:textfield]',
                    '[&::-webkit-inner-spin-button]:appearance-none',
                    '[&::-webkit-outer-spin-button]:appearance-none',
                ]),
            );
        }
    });

    // At 200% text the two pairs no longer fit a 136 px cell, so the minutes pair moves under the hours pair whole: a
    // unit never parts from its box, and nothing scrolls sideways.
    it('keeps each box with its unit, and lets the minutes pair wrap under the hours pair', () => {
        renderField();

        const hoursPair = hours().parentElement as HTMLElement;
        const minutesPair = minutes().parentElement as HTMLElement;

        expect(hoursPair).toBe(screen.getByText('h').parentElement);
        expect(minutesPair).toBe(screen.getByText('min').parentElement);
        expect(hoursPair.parentElement).toBe(minutesPair.parentElement);
        expect((hoursPair.parentElement as HTMLElement).className.split(/\s+/u)).toContain('flex-wrap');
    });

    // UI-overhaul slice 2: the boxes take the Input rules (`FIELD_CLASS`) rather than a geometry of their own.
    it('draws each box on the shared field surface, and the label in the FieldLabel role', () => {
        renderField();

        for (const box of [hours(), minutes()]) {
            expect(box.className.split(/\s+/u)).toEqual(expect.arrayContaining(FIELD_CLASS.split(' ')));
        }

        expect(screen.getByText('Timer (optional)').className.split(/\s+/u)).toEqual(
            expect.arrayContaining(['text-label', 'text-ink-muted']),
        );
    });
});
