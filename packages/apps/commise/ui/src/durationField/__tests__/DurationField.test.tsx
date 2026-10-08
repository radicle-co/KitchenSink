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
});
