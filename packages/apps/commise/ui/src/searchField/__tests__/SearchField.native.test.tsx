import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { AccessibilityInfo, Platform } from 'react-native';
import { useState } from 'react';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { SearchField } from '../SearchField.native.js';
import type { SearchFieldProps } from '../props.js';
import { role } from '../../tokens/colors.js';

// react-native-web does not implement `sendAccessibilityEvent`; the focus return reads its calls.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

/**
 * SearchField (native) — the 48 pt pill with a leading `search` glyph and, while non-empty, a clear control that
 * returns the screen-reader cursor to the field (`useScreenReaderFocusOnSignal`). The keyboard's return key says
 * "search" and the OS's own clear button is off, so there is one clear control, ours.
 */

afterEach(() => {
    cleanup();
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

function rgb(hex: string): string {
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

    return `rgb(${r}, ${g}, ${b})`;
}

function onPlatform(os: 'ios' | 'android'): () => void {
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

    return () => Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
}

function Search(props: Partial<SearchFieldProps> & { readonly initial?: string }) {
    const [value, setValue] = useState(props.initial ?? '');

    return (
        <SearchField
            id="search"
            label="Search recipes"
            labelVisibility="visible"
            clearLabel="Clear search"
            value={value}
            onChangeText={setValue}
            {...props}
        />
    );
}

/** The field: react-native-web renders a search TextInput as a textbox. */
const field = (): HTMLInputElement => screen.getByRole<HTMLInputElement>('textbox', { name: 'Search recipes' });

describe('SearchField (native)', () => {
    it('is named by its visible label', () => {
        render(<Search />);

        expect(field()).toBeTruthy();
        expect(screen.getByText('Search recipes')).toBeTruthy();
    });

    it('focuses the field when its visible label is pressed', () => {
        render(<Search />);

        fireEvent.click(screen.getByText('Search recipes'));

        expect(document.activeElement).toBe(field());
    });

    it('keeps a hidden label as the field’s name, drawing no label', () => {
        render(<Search labelVisibility="hidden" />);

        expect(field()).toBeTruthy();
        expect(screen.queryByText('Search recipes')).toBeNull();
    });

    it('asks for the search return key', () => {
        render(<Search />);

        expect(field().getAttribute('enterkeyhint')).toBe('search');
    });

    it('draws a 48pt pill on the lineControl edge, leading with an inkMuted search glyph', () => {
        const { container } = render(<Search />);
        const pill = field().parentElement as HTMLElement;
        const glyph = container.querySelector<HTMLElement>('[data-commise-stub="icon"]');

        expect(getComputedStyle(pill).minHeight).toBe('48px');
        expect(getComputedStyle(pill).borderTopLeftRadius).toBe('24px');
        expect(getComputedStyle(pill).borderTopColor).toBe(rgb(role.lineControl));
        expect(glyph?.dataset['iconName']).toBe('search');
        expect(glyph?.dataset['iconColor']).toBe(role.inkMuted);
    });

    it('shows no clear control while empty', () => {
        render(<Search />);

        expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    });

    it('clears a non-empty field and returns the screen-reader cursor to it', () => {
        render(<Search initial="lemon" />);

        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

        expect(field().value).toBe('');
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(field(), 'focus');
        expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    });

    it('gives the clear control a 44pt target on iOS and 48dp on Android', () => {
        for (const [os, size] of [
            ['ios', '44px'],
            ['android', '48px'],
        ] as const) {
            const restore = onPlatform(os);

            try {
                const { unmount } = render(<Search initial="lemon" />);
                const clear = getComputedStyle(screen.getByRole('button', { name: 'Clear search' }));

                expect(clear.minWidth, os).toBe(size);
                expect(clear.minHeight, os).toBe(size);
                unmount();
            } finally {
                restore();
            }
        }
    });

    it('reports the search key as a submit', () => {
        const onSubmit = vi.fn();
        render(<Search onSubmit={onSubmit} />);

        fireEvent.keyDown(field(), { key: 'Enter' });

        expect(onSubmit).toHaveBeenCalledOnce();
    });

    it('reports focus entering and leaving the field, so a screen can show an idle-state panel only while it is focused', () => {
        const onFocus = vi.fn();
        const onBlur = vi.fn();
        render(<Search onFocus={onFocus} onBlur={onBlur} />);

        // `focusIn`, not `focus`: React delegates `onFocus` to the bubbling `focusin` event.
        fireEvent.focusIn(field());

        expect(onFocus).toHaveBeenCalledOnce();

        fireEvent.focusOut(field());

        expect(onBlur).toHaveBeenCalledOnce();
    });
});
