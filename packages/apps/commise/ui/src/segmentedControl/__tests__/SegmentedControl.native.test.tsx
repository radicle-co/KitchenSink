import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { Platform } from 'react-native';
import { useState } from 'react';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { SegmentedControl } from '../SegmentedControl.native.js';
import { palette, role } from '../../tokens/colors.js';

/**
 * SegmentedControl (native) — a route is a `tablist` of `tab`s (`aria-selected`), a view a `radiogroup` of `radio`s
 * (`aria-checked`). One look for both: a `pearl` track 44 pt tall (48 dp on Android), the selected segment `paper` with
 * an `ink` label, the others `inkMuted`.
 */

afterEach(cleanup);

function rgb(hex: string): string {
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

    return `rgb(${r}, ${g}, ${b})`;
}

function onPlatform(os: 'ios' | 'android'): () => void {
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

    return () => Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
}

const PLACES = [
    { id: 'mine', label: 'My recipes' },
    { id: 'collections', label: 'Collections' },
] as const;

describe('SegmentedControl (native) — route', () => {
    it('is a tablist named by its label, the current tab selected', () => {
        render(<SegmentedControl form="route" label="Recipes" segments={PLACES} current="mine" onSelect={vi.fn()} />);

        const tabs = screen.getByRole('tablist', { name: 'Recipes' });

        expect(within(tabs).getByRole('tab', { name: 'My recipes' }).getAttribute('aria-selected')).toBe('true');
        expect(within(tabs).getByRole('tab', { name: 'Collections' }).getAttribute('aria-selected')).toBe('false');
    });

    it('reports a pressed tab', () => {
        const onSelect = vi.fn();
        render(<SegmentedControl form="route" label="Recipes" segments={PLACES} current="mine" onSelect={onSelect} />);

        fireEvent.click(screen.getByRole('tab', { name: 'Collections' }));

        expect(onSelect).toHaveBeenCalledWith('collections');
    });

    it('paints the current tab paper with an ink label, the other inkMuted, on a pearl track', () => {
        render(<SegmentedControl form="route" label="Recipes" segments={PLACES} current="mine" onSelect={vi.fn()} />);

        expect(getComputedStyle(screen.getByRole('tab', { name: 'My recipes' })).backgroundColor).toBe(rgb(role.paper));
        expect(getComputedStyle(screen.getByText('My recipes')).color).toBe(rgb(role.ink));
        expect(getComputedStyle(screen.getByText('Collections')).color).toBe(rgb(role.inkMuted));
        expect(getComputedStyle(screen.getByRole('tablist', { name: 'Recipes' })).backgroundColor).toBe(
            rgb(palette.pearl),
        );
    });

    it('is 44 pt tall on iOS and 48 dp on Android', () => {
        for (const [os, height] of [
            ['ios', '44px'],
            ['android', '48px'],
        ] as const) {
            const restore = onPlatform(os);

            try {
                const { unmount } = render(
                    <SegmentedControl
                        form="route"
                        label="Recipes"
                        segments={PLACES}
                        current="mine"
                        onSelect={vi.fn()}
                    />,
                );

                expect(getComputedStyle(screen.getByRole('tablist', { name: 'Recipes' })).minHeight, os).toBe(height);
                unmount();
            } finally {
                restore();
            }
        }
    });

    it('gives every segment the same share of the track', () => {
        render(<SegmentedControl form="route" label="Recipes" segments={PLACES} current="mine" onSelect={vi.fn()} />);

        for (const name of ['My recipes', 'Collections']) {
            const style = getComputedStyle(screen.getByRole('tab', { name }));

            expect(style.flexGrow).toBe('1');
            expect(style.flexBasis).toBe('0px');
        }
    });
});

function ViewSwitch() {
    const [value, setValue] = useState('list');

    return (
        <SegmentedControl
            form="view"
            label="Layout"
            segments={[
                { id: 'list', label: 'List view', icon: 'menu' },
                { id: 'grid', label: 'Grid view' },
            ]}
            value={value}
            onChange={setValue}
        />
    );
}

describe('SegmentedControl (native) — view', () => {
    it('is a radiogroup, the value checked, and switches on press', () => {
        render(<ViewSwitch />);

        expect(screen.getByRole('radio', { name: 'List view' }).getAttribute('aria-checked')).toBe('true');

        fireEvent.click(screen.getByRole('radio', { name: 'Grid view' }));

        expect(screen.getByRole('radio', { name: 'Grid view' }).getAttribute('aria-checked')).toBe('true');
        expect(screen.getByRole('radiogroup', { name: 'Layout' })).toBeTruthy();
    });

    it('draws a segment’s glyph in its label’s colour', () => {
        render(<ViewSwitch />);

        const glyph = screen
            .getByRole('radio', { name: 'List view' })
            .querySelector<HTMLElement>('[data-commise-stub="icon"]');

        expect(glyph?.dataset['iconName']).toBe('menu');
        expect(glyph?.dataset['iconColor']).toBe(role.ink);
    });
});
