import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { Platform } from 'react-native';
import { useState } from 'react';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { Chip } from '../Chip.native.js';
import { ChipRow } from '../ChipRow.native.js';
import type { ChipOption } from '../props.js';
import { role } from '../../tokens/colors.js';
import { nativeTokens } from '../../tokens/native.js';

/**
 * Chip and ChipRow (native) — rendered via react-native-web under jsdom, glyphs through the `lucideNativeStub`.
 * Native semantics (spec §1.11): a filter chip is a `checkbox`, a choice option a `radio` in a `radiogroup`, both with
 * `accessibilityState.checked`; an input chip is a button named by its remove label. The pill is 36 visual points, hit
 * at 44 (48 dp on Android).
 */

afterEach(cleanup);

/** `#RRGGBB` → jsdom's `rgb(r, g, b)`. */
function rgb(hex: string): string {
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

    return `rgb(${r}, ${g}, ${b})`;
}

/** The painted pill inside a chip: the element with its edge. */
function pillOf(chip: HTMLElement): HTMLElement {
    const pill = [chip, ...Array.from(chip.querySelectorAll<HTMLElement>('*'))].find(
        (element) => Number.parseFloat(getComputedStyle(element).borderTopWidth) > 0,
    );

    if (pill === undefined) {
        throw new Error('The chip paints no edge.');
    }

    return pill;
}

const glyphIn = (element: HTMLElement): string | undefined =>
    element.querySelector<HTMLElement>('[data-commise-stub="icon"]')?.dataset['iconName'];

/** Render under a given React Native platform, restoring react-native-web's own `web` afterwards. */
function onPlatform(os: 'ios' | 'android'): () => void {
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

    return () => Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
}

describe('Chip (native) — filter', () => {
    it('is a checkbox whose checked state follows selected', () => {
        const { rerender } = render(<Chip kind="filter" label="Vegan" selected={false} onPress={vi.fn()} />);

        expect(screen.getByRole('checkbox', { name: 'Vegan' }).getAttribute('aria-checked')).toBe('false');

        rerender(<Chip kind="filter" label="Vegan" selected onPress={vi.fn()} />);

        expect(screen.getByRole('checkbox', { name: 'Vegan' }).getAttribute('aria-checked')).toBe('true');
    });

    it('calls onPress when pressed', () => {
        const onPress = vi.fn();
        render(<Chip kind="filter" label="Vegan" selected={false} onPress={onPress} />);

        fireEvent.click(screen.getByRole('checkbox', { name: 'Vegan' }));

        expect(onPress).toHaveBeenCalledOnce();
    });

    it('rests on paper with a 1pt lineControl edge and an ink label', () => {
        render(<Chip kind="filter" label="Vegan" selected={false} onPress={vi.fn()} />);

        // Read the label's font FIRST: jsdom's computed-style cache reports the shim's system stack for a child's
        // `fontFamily` once its ancestors' styles have been computed (measured; the order is a harness artefact).
        expect(getComputedStyle(screen.getByText('Vegan')).fontFamily).toBe(nativeTokens.type.label.fontFamily);

        const pill = getComputedStyle(pillOf(screen.getByRole('checkbox', { name: 'Vegan' })));

        expect(pill.backgroundColor).toBe(rgb(role.paper));
        expect(pill.borderTopColor).toBe(rgb(role.lineControl));
        expect(pill.borderTopWidth).toBe('1px');
        expect(getComputedStyle(screen.getByText('Vegan')).color).toBe(rgb(role.ink));
    });

    it('shows selection by tint, a 1.5pt selectedEdge, an actionText label AND a check', () => {
        render(<Chip kind="filter" label="Vegan" selected onPress={vi.fn()} />);

        const chip = screen.getByRole('checkbox', { name: 'Vegan' });
        const pill = getComputedStyle(pillOf(chip));

        expect(pill.backgroundColor).toBe(rgb(role.selectedFill));
        expect(pill.borderTopColor).toBe(rgb(role.selectedEdge));
        expect(pill.borderTopWidth).toBe('1.5px');
        expect(getComputedStyle(screen.getByText('Vegan')).color).toBe(rgb(role.actionText));
        expect(glyphIn(chip)).toBe('check');
    });

    it('draws no check while unselected', () => {
        render(<Chip kind="filter" label="Vegan" selected={false} onPress={vi.fn()} />);

        expect(glyphIn(screen.getByRole('checkbox', { name: 'Vegan' }))).toBeUndefined();
    });

    it('draws a 36pt pill inside a 44pt hit area on iOS, 48dp on Android', () => {
        for (const [os, hit] of [
            ['ios', '44px'],
            ['android', '48px'],
        ] as const) {
            const restore = onPlatform(os);

            try {
                const { unmount } = render(<Chip kind="filter" label="Vegan" selected={false} onPress={vi.fn()} />);
                const chip = screen.getByRole('checkbox', { name: 'Vegan' });

                expect(getComputedStyle(chip).minHeight, os).toBe(hit);
                expect(getComputedStyle(pillOf(chip)).minHeight, os).toBe('36px');
                unmount();
            } finally {
                restore();
            }
        }
    });

    it('shows a count in tabular inkMuted digits, inside the accessible name', () => {
        render(<Chip kind="filter" label="Vegan" selected={false} count={12} onPress={vi.fn()} />);

        expect(getComputedStyle(screen.getByText('12')).color).toBe(rgb(role.inkMuted));
        expect(screen.getByRole('checkbox', { name: 'Vegan 12' })).toBeTruthy();
    });

    it('truncates a label over 24 characters, keeping the full label as its name', () => {
        const long = 'Gluten-free and dairy-free options';
        render(<Chip kind="filter" label={long} selected={false} onPress={vi.fn()} />);

        expect(within(screen.getByRole('checkbox', { name: long })).getByText('Gluten-free and dairy-f…')).toBeTruthy();
    });
});

describe('Chip (native) — input', () => {
    it('is a button named by its remove label, with a trailing x, that removes itself', () => {
        const onRemove = vi.fn();
        render(<Chip kind="input" label="Vegan" removeLabel="Remove Vegan" onRemove={onRemove} />);

        const chip = screen.getByRole('button', { name: 'Remove Vegan' });
        fireEvent.click(chip);

        expect(glyphIn(chip)).toBe('x');
        expect(onRemove).toHaveBeenCalledOnce();
    });
});

const DIFFICULTY: readonly ChipOption[] = [
    { value: 'easy', label: 'Easy' },
    { value: 'medium', label: 'Medium' },
    { value: 'hard', label: 'Hard' },
];

function Choice({
    clearable = false,
    initial = null,
}: {
    readonly clearable?: boolean;
    readonly initial?: string | null;
}) {
    const [value, setValue] = useState<string | null>(initial);

    return (
        <ChipRow
            mode="choice"
            label="Difficulty"
            overflow="wrap"
            options={DIFFICULTY}
            value={value}
            onChange={setValue}
            clearable={clearable}
        />
    );
}

describe('ChipRow (native) — choice', () => {
    it('is a radiogroup named by its label, one radio per option', () => {
        render(<Choice />);

        const group = screen.getByRole('radiogroup', { name: 'Difficulty' });

        expect(within(group).getAllByRole('radio')).toHaveLength(3);
    });

    it('checks the chosen option and shows it selected, with a check', () => {
        render(<Choice initial="medium" />);

        const medium = screen.getByRole('radio', { name: 'Medium' });

        expect(medium.getAttribute('aria-checked')).toBe('true');
        expect(screen.getByRole('radio', { name: 'Easy' }).getAttribute('aria-checked')).toBe('false');
        expect(glyphIn(medium)).toBe('check');
    });

    it('chooses an option on press, and keeps it when pressed again', () => {
        render(<Choice />);

        fireEvent.click(screen.getByRole('radio', { name: 'Hard' }));
        fireEvent.click(screen.getByRole('radio', { name: 'Hard' }));

        expect(screen.getByRole('radio', { name: 'Hard' }).getAttribute('aria-checked')).toBe('true');
    });

    it('clears a clearable row’s choice when its option is pressed again', () => {
        render(<Choice clearable initial="easy" />);

        fireEvent.click(screen.getByRole('radio', { name: 'Easy' }));

        expect(screen.getAllByRole('radio').every((radio) => radio.getAttribute('aria-checked') === 'false')).toBe(
            true,
        );
    });
});

describe('ChipRow (native) — filter and input', () => {
    it('is a group named by its label, holding the chips it is given', () => {
        render(
            <ChipRow mode="filter" label="Diet" overflow="wrap">
                <Chip kind="filter" label="Vegan" selected={false} onPress={vi.fn()} />
                <Chip kind="filter" label="Halal" selected onPress={vi.fn()} />
            </ChipRow>,
        );

        expect(within(screen.getByRole('group', { name: 'Diet' })).getAllByRole('checkbox')).toHaveLength(2);
    });

    it('scrolls one line horizontally inside itself when its overflow is scroll', () => {
        render(
            <ChipRow mode="input" label="Applied filters" overflow="scroll">
                <Chip kind="input" label="Vegan" removeLabel="Remove Vegan" onRemove={vi.fn()} />
            </ChipRow>,
        );

        const group = screen.getByRole('group', { name: 'Applied filters' });
        const scroller = [group, ...Array.from(group.querySelectorAll<HTMLElement>('*'))].find(
            (element) =>
                getComputedStyle(element).overflowX === 'auto' || getComputedStyle(element).overflowX === 'scroll',
        );

        expect(scroller).toBeDefined();
    });

    it('wraps when its overflow is wrap', () => {
        render(
            <ChipRow mode="filter" label="Diet" overflow="wrap">
                <Chip kind="filter" label="Vegan" selected={false} onPress={vi.fn()} />
            </ChipRow>,
        );

        expect(getComputedStyle(screen.getByRole('group', { name: 'Diet' })).flexWrap).toBe('wrap');
    });
});
