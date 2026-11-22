/**
 * The native cooking timer row: the frame, its three states and the summary part. Mutation lens: a wrong glyph per
 * state
 * fails the glyph rows; a row that is itself one accessible element hides its buttons from a screen reader and fails
 * the
 * container row; a glyph that stays above 1.3x text fails the hide rows; two 48 dp frames that overlap fail the gap
 * row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

const platform = vi.hoisted(() => ({ os: undefined as 'android' | undefined }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        Platform: {
            ...actual.Platform,
            get OS() {
                return platform.os ?? actual.Platform.OS;
            },
        },
    };
});

import { renderWithTamagui, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import { CookingTimerRow } from '../CookingTimerRow.native.js';
import { CookingTimerSummary } from '../CookingTimerSummary.native.js';
import type { CookingTimerRowState } from '../props.js';

afterEach(() => {
    cleanup();
    platform.os = undefined;
});

const summary = (
    <CookingTimerSummary
        figure="1:09:50"
        status="Paused"
        meta="Roast, step 4"
        accessibilityLabel="Roast, paused, 1 hour 9 minutes left"
    />
);

const running = (pause = vi.fn(), cancel = vi.fn()): CookingTimerRowState => ({
    kind: 'running',
    pause: { label: 'Pause Roast timer', onPress: pause },
    cancel: { label: 'Cancel Roast timer', onPress: cancel },
});

function glyphNames(button: HTMLElement): string | undefined {
    return (button.querySelector('[data-commise-stub="icon"]') as HTMLElement | null)?.dataset['iconName'];
}

describe('CookingTimerRow (native), per state', () => {
    it('running: Pause and Cancel, each pressing its own callback once', () => {
        const pause = vi.fn();
        const cancel = vi.fn();
        renderWithTamagui(<CookingTimerRow state={running(pause, cancel)} body={summary} />, 'light');

        expect(glyphNames(screen.getByRole('button', { name: 'Pause Roast timer' }))).toBe('pause');
        expect(glyphNames(screen.getByRole('button', { name: 'Cancel Roast timer' }))).toBe('x');

        fireEvent.click(screen.getByRole('button', { name: 'Pause Roast timer' }));
        expect(pause).toHaveBeenCalledTimes(1);
        expect(cancel).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel Roast timer' }));
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('paused: Resume and Cancel', () => {
        const resume = vi.fn();
        renderWithTamagui(
            <CookingTimerRow
                state={{
                    kind: 'paused',
                    resume: { label: 'Resume Roast timer', onPress: resume },
                    cancel: { label: 'Cancel Roast timer', onPress: vi.fn() },
                }}
                body={summary}
            />,
            'light',
        );

        expect(glyphNames(screen.getByRole('button', { name: 'Resume Roast timer' }))).toBe('play');
        fireEvent.click(screen.getByRole('button', { name: 'Resume Roast timer' }));
        expect(resume).toHaveBeenCalledTimes(1);
    });

    it('done: one Stop', () => {
        const stop = vi.fn();
        renderWithTamagui(
            <CookingTimerRow
                state={{ kind: 'done', stop: { label: 'Stop Roast timer', onPress: stop } }}
                body={summary}
            />,
            'light',
        );

        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(glyphNames(screen.getByRole('button', { name: 'Stop Roast timer' }))).toBe('x');
        fireEvent.click(screen.getByRole('button', { name: 'Stop Roast timer' }));
        expect(stop).toHaveBeenCalledTimes(1);
    });
});

describe('CookingTimerRow (native), the frame', () => {
    it('is not one accessible element and not a live region, so the buttons stay reachable', () => {
        const { container } = renderWithTamagui(<CookingTimerRow state={running()} body={summary} />, 'light');

        expect(screen.getAllByRole('button')).toHaveLength(2);
        expect(container.querySelector('[aria-live]')).toBeNull();
        const row = container.querySelector('[name="CookingTimerRow"]');

        expect(row?.getAttribute('aria-label')).toBeNull();
        expect(row?.getAttribute('role')).toBeNull();
    });

    it('keeps the two actions apart: 48 dp frames on Android with a 4 dp gap, 44 on iOS with an 8 dp gap', () => {
        const widths = (): number[] =>
            screen
                .getAllByRole('button')
                .map((b) => parseFloat(getComputedStyle(b.firstElementChild as HTMLElement).width));

        const gap = (container: HTMLElement): string =>
            resolvedStyle(container.querySelector('[name="CookingTimerRow"]') as Element, 'gap');

        const ios = renderWithTamagui(<CookingTimerRow state={running()} body={summary} />, 'light');
        expect(widths()).toEqual([44, 44]);
        expect(gap(ios.container)).toBe('8px');
        cleanup();

        platform.os = 'android';
        const android = renderWithTamagui(<CookingTimerRow state={running()} body={summary} />, 'light');
        expect(widths()).toEqual([48, 48]);
        expect(gap(android.container)).toBe('4px');
    });
});

describe('CookingTimerSummary (native)', () => {
    it('is one accessible element named by the passed-in string', () => {
        renderWithTamagui(summary, 'light');

        expect(screen.getByLabelText('Roast, paused, 1 hour 9 minutes left')).toBeTruthy();
    });

    it('shows the time, the status and the meta', () => {
        renderWithTamagui(summary, 'light');

        expect(screen.getByText('1:09:50')).toBeTruthy();
        expect(screen.getByText('Paused')).toBeTruthy();
        expect(screen.getByText('Roast, step 4')).toBeTruthy();
    });

    it('draws the timer glyph up to 1.3x text and none above it', () => {
        renderWithTamagui(summary, 'light', 1.3);
        expect(document.querySelector('[data-commise-stub="icon"]')).not.toBeNull();
        cleanup();

        renderWithTamagui(summary, 'light', 1.31);
        expect(document.querySelector('[data-commise-stub="icon"]')).toBeNull();
    });

    it('sets the time in figureLarge, whose size grows to the display cap and no further', () => {
        renderWithTamagui(summary, 'light', 3);

        expect(getComputedStyle(screen.getByText('1:09:50')).fontSize).toBe('42px');
    });
});
