/**
 * The native editor's action bar (build spec §7.1, §7.8). A-006: the bar pads the bottom for the system navigation bar,
 * but the on-screen keyboard covers that bar, so the padding is a dead band above the keys while it is up.
 */
import { cleanup, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { nativeTokens } from '@commise/ui/native';
import { rgb, rolesFor } from '@commise/ui/testing/system-color-scheme';
import { render, renderWithTamagui, resolvedColour } from '@commise/ui/testing/tamagui';

import { EditorActionBar } from '../EditorActionBar.native.js';
import type { EditorActionBarProps } from '../frameProps.js';

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 47, left: 0 }),
}));

afterEach(cleanup);

const props: EditorActionBarProps = {
    label: 'Recipe actions',
    previewLabel: 'Preview',
    onPreview: vi.fn(),
    primaryLabel: 'Publish',
    onPrimary: vi.fn(),
    primaryDisabled: false,
    busy: false,
};

/** The bar's outer box: the parent of its control group. */
const barOf = (): HTMLElement | null => screen.getByRole('group', { name: 'Recipe actions' }).parentElement;

describe('EditorActionBar (native): the bottom inset', () => {
    it('clears the system navigation bar when the keyboard is down', () => {
        render(<EditorActionBar {...props} />);

        expect(barOf()?.style.paddingBottom).toBe('47px');
    });

    it('⛔ drops the navigation inset while the keyboard is up: the keyboard covers that bar', () => {
        render(<EditorActionBar {...props} keyboardShown />);

        expect(barOf()?.style.paddingBottom).toBe('12px');
    });

    it('keeps the controls either way', () => {
        render(<EditorActionBar {...props} keyboardShown />);

        expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
    });
});

describe('EditorActionBar (native): large text and narrow widths (build spec §1.1, §7.1)', () => {
    it('⛔ lets the controls wrap, so a row too wide for the bar stacks instead of pushing Preview off the left edge', () => {
        render(<EditorActionBar {...props} />);

        const controls = screen.getByRole('group', { name: 'Recipe actions' });

        expect(getComputedStyle(controls).flexWrap).toBe('wrap');
    });

    it('keeps Publish after Preview, so a stacked bar leaves the primary at the bottom, nearest the thumb', () => {
        render(<EditorActionBar {...props} />);

        const buttons = screen.getAllByRole('button').map((b) => b.textContent);

        expect(buttons.indexOf('Publish')).toBeGreaterThan(buttons.indexOf('Preview'));
    });
});

/**
 * The two lines above the controls are typed live regions (ADR-0080 §8): the design-system Text in the `meta` role, so
 * they grow with the system text size, size and leading together, to the 2× cap. What still needs fixing is a failure,
 * in `dangerText`; that the recipe is ready is a quiet note, in `inkMuted`. Each is read in both schemes.
 */
describe('EditorActionBar (native): the fix and ready lines', () => {
    const FIX = 'Add a title to publish.';
    const READY = 'Ready to publish.';

    it('sets both lines in the meta role, and grows them with the system text size to the 2× cap', () => {
        const spec = nativeTokens.type.meta;
        renderWithTamagui(<EditorActionBar {...props} fixLine={FIX} readyLine={READY} />, 'light', 3.1);

        for (const line of [FIX, READY]) {
            const style = getComputedStyle(screen.getByText(line));

            expect(style.fontFamily, line).toContain(spec.fontFamily);
            expect(style.fontSize, line).toBe(`${String(spec.fontSize * 2)}px`);
            expect(style.lineHeight, line).toBe(`${String(spec.lineHeight * 2)}px`);
        }
    });

    it.each(['light', 'dark'] as const)(
        'paints the fix in dangerText and the ready line in inkMuted (%s)',
        (scheme) => {
            renderWithTamagui(<EditorActionBar {...props} fixLine={FIX} readyLine={READY} />, scheme);

            expect(resolvedColour(screen.getByText(FIX), 'color')).toBe(rgb(rolesFor(scheme).dangerText));
            expect(resolvedColour(screen.getByText(READY), 'color')).toBe(rgb(rolesFor(scheme).inkMuted));
        },
    );

    it('speaks each line politely', () => {
        renderWithTamagui(<EditorActionBar {...props} fixLine={FIX} readyLine={READY} />, 'light');

        expect(screen.getByText(FIX).getAttribute('aria-live')).toBe('polite');
        expect(screen.getByText(READY).getAttribute('aria-live')).toBe('polite');
    });
});

/** The web leaf's "waiting for photos" cases, on native (staff-ux SPECIFY 2026-11-10). */
describe('EditorActionBar (native): waiting for photos', () => {
    const DRAIN = 'Recipe saved. Finishing your photo uploads…';
    const FAILED = '1 photo didn’t upload. Retry it, or finish without it.';
    const finishing = (line: string, danger: boolean) => ({
        line,
        danger,
        actionLabel: 'Finish without the remaining photos',
        onAction: vi.fn(),
        focusRequested: false,
        onFocusRequestHandled: vi.fn(),
    });

    it('replaces Preview and Publish with the one Finish control', () => {
        const state = finishing(DRAIN, false);
        render(<EditorActionBar {...props} finishing={state} />);

        expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Finish without the remaining photos' }));
        expect(state.onAction).toHaveBeenCalledOnce();
    });

    it.each(['light', 'dark'] as const)('paints the wait in inkMuted and a failure in dangerText (%s)', (scheme) => {
        renderWithTamagui(<EditorActionBar {...props} finishing={finishing(DRAIN, false)} />, scheme);
        expect(resolvedColour(screen.getByText(DRAIN), 'color')).toBe(rgb(rolesFor(scheme).inkMuted));
        cleanup();

        renderWithTamagui(<EditorActionBar {...props} finishing={finishing(FAILED, true)} />, scheme);
        expect(resolvedColour(screen.getByText(FAILED), 'color')).toBe(rgb(rolesFor(scheme).dangerText));
    });
});
