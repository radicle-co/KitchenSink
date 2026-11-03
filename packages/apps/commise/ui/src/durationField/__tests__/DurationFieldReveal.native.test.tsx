/**
 * The native `DurationField` and the field reveal (`docs/design/uiOverhaul/specSharedSystem.md` §16.3): a focused hours
 * or minutes box asks the reveal host to hold it in view and lets go on blur. Without it the keyboard covered the box and
 * the editor did not scroll (qa-ios, 2026-11-03).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FieldRevealContext, type FieldRevealer } from '../../fieldReveal/fieldRevealContext.js';
import { DurationField } from '../DurationField.native.js';

afterEach(cleanup);

function hosted() {
    const release = vi.fn();
    const revealer = vi.fn<FieldRevealer>(() => release);

    render(
        <FieldRevealContext.Provider value={revealer}>
            <DurationField
                label="Prep time"
                hoursLabel="Prep hours"
                minutesLabel="Prep minutes"
                hoursUnit="h"
                minutesUnit="min"
                value={600}
                onChange={vi.fn()}
            />
        </FieldRevealContext.Provider>,
    );

    return { release, revealer };
}

describe.each([['Prep hours'], ['Prep minutes']])(
    'DurationField (native) — the %s box and the field reveal',
    (name) => {
        const box = (): HTMLElement => screen.getByRole('textbox', { name });

        it('sends nothing before the box is focused', () => {
            const { revealer } = hosted();

            expect(revealer).not.toHaveBeenCalled();
        });

        it('sends a focus request carrying its own node when it gains focus', () => {
            const { revealer } = hosted();

            act(() => {
                fireEvent.focus(box());
            });

            expect(revealer).toHaveBeenCalledTimes(1);
            expect(revealer.mock.calls[0]?.[0]).toMatchObject({ kind: 'focus' });
            expect(revealer.mock.calls[0]?.[0].field).toBe(box());
        });

        it('lets the request go when it loses focus', () => {
            const { release } = hosted();

            act(() => {
                fireEvent.focus(box());
            });
            act(() => {
                fireEvent.blur(box());
            });

            expect(release).toHaveBeenCalledTimes(1);
        });
    },
);
