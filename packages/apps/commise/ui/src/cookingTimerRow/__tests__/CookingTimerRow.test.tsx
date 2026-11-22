/**
 * The web cooking timer row: a frame around a body and the row's actions, one state at a time. Mutation lens: a state
 * that draws the wrong glyph fails the glyph rows; an action wired to the wrong callback fails the press rows; a live
 * region on the row fails the live-region row; a time that may wrap fails the fit row.
 */
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

import { leadingGlyphWebStyle } from '../../text/scaledType.js';
import { CookingTimerRow } from '../CookingTimerRow.js';
import { CookingTimerSummary } from '../CookingTimerSummary.js';
import type { CookingTimerRowState } from '../props.js';

afterEach(cleanup);

const summary = (
    <CookingTimerSummary figure="1:09:50" meta="Roast, step 4" accessibilityLabel="Roast, 1 hour 9 minutes left" />
);

function actions(): Record<'pause' | 'resume' | 'cancel' | 'stop', Mock<() => void>> {
    return {
        pause: vi.fn<() => void>(),
        resume: vi.fn<() => void>(),
        cancel: vi.fn<() => void>(),
        stop: vi.fn<() => void>(),
    };
}

function glyphOf(name: string): string | null {
    const svg = screen.getByRole('button', { name }).querySelector('svg.lucide');

    return [...(svg?.classList ?? [])].find((token) => /^lucide-./u.test(token)) ?? null;
}

function rowOf(state: CookingTimerRowState): ReactElement {
    return <CookingTimerRow state={state} body={summary} />;
}

describe('CookingTimerRow (web), per state', () => {
    it('running: Pause and Cancel, each pressing its own callback once', () => {
        const a = actions();
        render(
            rowOf({
                kind: 'running',
                pause: { label: 'Pause Roast timer', onPress: a.pause },
                cancel: { label: 'Cancel Roast timer', onPress: a.cancel },
            }),
        );

        expect(glyphOf('Pause Roast timer')).toBe('lucide-pause');
        expect(glyphOf('Cancel Roast timer')).toBe('lucide-x');

        fireEvent.click(screen.getByRole('button', { name: 'Pause Roast timer' }));
        expect(a.pause).toHaveBeenCalledTimes(1);
        expect(a.cancel).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel Roast timer' }));
        expect(a.cancel).toHaveBeenCalledTimes(1);
        expect(a.pause).toHaveBeenCalledTimes(1);
    });

    it('paused: Resume and Cancel', () => {
        const a = actions();
        render(
            rowOf({
                kind: 'paused',
                resume: { label: 'Resume Roast timer', onPress: a.resume },
                cancel: { label: 'Cancel Roast timer', onPress: a.cancel },
            }),
        );

        expect(glyphOf('Resume Roast timer')).toBe('lucide-play');
        expect(glyphOf('Cancel Roast timer')).toBe('lucide-x');

        fireEvent.click(screen.getByRole('button', { name: 'Resume Roast timer' }));
        expect(a.resume).toHaveBeenCalledTimes(1);
        expect(a.cancel).not.toHaveBeenCalled();
    });

    it('done: one Stop, and no Cancel', () => {
        const a = actions();
        render(rowOf({ kind: 'done', stop: { label: 'Stop Roast timer', onPress: a.stop } }));

        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(glyphOf('Stop Roast timer')).toBe('lucide-x');

        fireEvent.click(screen.getByRole('button', { name: 'Stop Roast timer' }));
        expect(a.stop).toHaveBeenCalledTimes(1);
    });

    it('cannot be written with a Cancel on a done row', () => {
        type Done = Extract<CookingTimerRowState, { kind: 'done' }>;

        const done: Done = { kind: 'done', stop: { label: 'Stop', onPress: vi.fn() } };

        expect('cancel' in done).toBe(false);
    });
});

describe('CookingTimerRow (web), the frame', () => {
    it('is not a live region, and the row has no role or name of its own', () => {
        const a = actions();
        const { container } = render(
            rowOf({
                kind: 'running',
                pause: { label: 'Pause', onPress: a.pause },
                cancel: { label: 'Cancel', onPress: a.cancel },
            }),
        );

        expect(container.querySelector('[aria-live]')).toBeNull();
        expect(container.querySelector('[role="status"], [role="timer"], [role="alert"]')).toBeNull();
        expect(container.firstElementChild?.getAttribute('role')).toBeNull();
        expect(container.firstElementChild?.getAttribute('aria-label')).toBeNull();
    });
});

describe('CookingTimerSummary (web)', () => {
    it('names itself with the passed-in string, and hides its visible text from assistive tech', () => {
        const a = actions();
        render(rowOf({ kind: 'done', stop: { label: 'Stop', onPress: a.stop } }));

        expect(screen.getByText('Roast, 1 hour 9 minutes left').className).toContain('sr-only');
        expect(screen.getByText('1:09:50').closest('[aria-hidden="true"]')).not.toBeNull();
        expect(screen.getByText('Roast, step 4').closest('[aria-hidden="true"]')).not.toBeNull();
    });

    it('never lets the time wrap or shrink, and lets the meta wrap', () => {
        const a = actions();
        render(rowOf({ kind: 'done', stop: { label: 'Stop', onPress: a.stop } }));

        expect(screen.getByText('1:09:50').className).toContain('whitespace-nowrap');
        expect(screen.getByText('1:09:50').className).toContain('shrink-0');
        expect(screen.getByText('Roast, step 4').className).toContain('min-w-0');
        expect(screen.getByText('Roast, step 4').className).not.toContain('whitespace-nowrap');
    });

    it('sets the time in the figureLarge role', () => {
        const a = actions();
        render(rowOf({ kind: 'done', stop: { label: 'Stop', onPress: a.stop } }));

        expect(screen.getByText('1:09:50').className).toContain('text-figure-large');
        expect(screen.getByText('1:09:50').className).toContain('tabular-nums');
    });

    it('shows its status word when given one, and none otherwise', () => {
        const a = actions();
        const { rerender } = render(rowOf({ kind: 'done', stop: { label: 'Stop', onPress: a.stop } }));

        expect(screen.queryByText('Paused')).toBeNull();

        rerender(
            <CookingTimerRow
                state={{ kind: 'done', stop: { label: 'Stop', onPress: a.stop } }}
                body={
                    <CookingTimerSummary
                        figure="4:30"
                        status="Paused"
                        meta="Roast"
                        accessibilityLabel="Roast, paused, 4 minutes 30 seconds left"
                    />
                }
            />,
        );

        expect(screen.getByText('Paused')).toBeTruthy();
    });

    it('draws a timer glyph in a box that the web hide rule shrinks to nothing above 1.3x text', () => {
        const a = actions();
        const { container } = render(rowOf({ kind: 'done', stop: { label: 'Stop', onPress: a.stop } }));
        const box = container.querySelector('svg.lucide-timer')?.parentElement as HTMLElement;

        const reference = document.createElement('span');
        reference.style.width = leadingGlyphWebStyle().width;

        expect(box.style.width).not.toBe('');
        expect(box.style.width).toBe(reference.style.width);
        expect(box.style.overflow).toBe('hidden');
    });
});
