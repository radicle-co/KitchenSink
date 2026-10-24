/**
 * The native editor's action bar (build spec §7.1, §7.8). A-006: the bar pads the bottom for the system navigation bar,
 * but the on-screen keyboard covers that bar, so the padding is a dead band above the keys while it is up.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
