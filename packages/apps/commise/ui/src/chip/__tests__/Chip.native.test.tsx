import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { useState } from 'react';

import { withPlatformOs } from '../../testing/platformOs.native.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { Chip } from '../Chip.native.js';
import { ChipRow } from '../ChipRow.native.js';
import { Button } from '../../button/Button.native.js';
import type { ChipOption } from '../props.js';
import { chipLabel, chipPill } from '../chipStyle.js';
import { role, roleDark } from '../../tokens/colors.js';
import { themeFor } from '../../theme/themeFor.js';
import { nativeTokens } from '../../tokens/native.js';

/**
 * Chip and ChipRow (native) — rendered via react-native-web under jsdom, glyphs through the `lucideNativeStub`.
 * Native semantics (spec §1.11): a filter chip is a `checkbox`, a choice option a `radio` in a `radiogroup`, both with
 * `accessibilityState.checked`; an input chip is a button named by its remove label. The pill is 32 visual points, hit
 * at 44 (48 dp on Android), on `surfaceMuted` with no edge at rest (`componentFixes.md` §4).
 */

afterEach(cleanup);

/** `#RRGGBB` → jsdom's `rgb(r, g, b)`. */
function rgb(hex: string): string {
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

    return `rgb(${r}, ${g}, ${b})`;
}

/** The painted pill inside a chip: the rounded element (a resting chip draws no edge to find it by). */
function pillOf(chip: HTMLElement): HTMLElement {
    const pill = [chip, ...Array.from(chip.querySelectorAll<HTMLElement>('*'))].find(
        (element) => Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) > 0,
    );

    if (pill === undefined) {
        throw new Error('The chip paints no pill.');
    }

    return pill;
}

const glyphIn = (element: HTMLElement): string | undefined =>
    element.querySelector<HTMLElement>('[data-commise-stub="icon"]')?.dataset['iconName'];

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

    it('rests on surfaceMuted with no edge and an ink caption label (14/500)', () => {
        render(<Chip kind="filter" label="Vegan" selected={false} onPress={vi.fn()} />);

        // Read the label's font FIRST: jsdom's computed-style cache reports the shim's system stack for a child's
        // `fontFamily` once its ancestors' styles have been computed (measured; the order is a harness artefact).
        expect(getComputedStyle(screen.getByText('Vegan')).fontFamily).toBe(nativeTokens.type.caption.fontFamily);
        expect(nativeTokens.type.caption.fontFamily).not.toBe(nativeTokens.type.label.fontFamily);

        const pill = getComputedStyle(pillOf(screen.getByRole('checkbox', { name: 'Vegan' })));

        expect(pill.backgroundColor).toBe(rgb(role.surfaceMuted));
        // Ruling 4: the edge is there at rest, in a transparent colour, at the selected width.
        expect(pill.borderTopWidth).toBe('1.5px');
        expect(getComputedStyle(screen.getByText('Vegan')).color).toBe(rgb(role.ink));
    });

    // Ruling 4 (`componentFixes` issue 4): selecting a chip must never shift its neighbours. Mutation lens: a rest edge of
    // 0 (the old value) or any width other than the selected one fails the equality.
    it('keeps the same edge width and a transparent edge colour at rest, so selecting moves nothing', () => {
        const theme = themeFor('light');
        const rest = chipPill(theme, false, false, 'canvas');
        const selected = chipPill(theme, true, false, 'canvas');

        expect(rest.borderWidth).toBe(1.5);
        expect(rest.borderWidth).toBe(selected.borderWidth);
        expect(rest.borderColor).toBe('transparent');
        expect(selected.borderColor).toBe(theme.colors.selectedEdge);
    });

    it('⛔ cannot be mistaken for a secondary button: a different fill and no edge, side by side', () => {
        render(
            <>
                <Chip kind="filter" label="Vegan" selected={false} onPress={vi.fn()} />
                <Button variant="secondary" icon="plus" onPress={vi.fn()}>
                    Add
                </Button>
            </>,
        );

        const chip = getComputedStyle(pillOf(screen.getByRole('checkbox', { name: 'Vegan' })));
        const button = getComputedStyle(screen.getByText('Add').parentElement as HTMLElement);

        expect(chip.backgroundColor).not.toBe(button.backgroundColor);
        expect(chip.borderTopWidth).not.toBe(button.borderTopWidth);
        expect(button.borderTopWidth).toBe('1px');
    });

    // REWRITTEN for `componentFixes.md` §10a: a chip rests on its surface's chip fill (surfaceMuted, or paper on a muted
    // surface) and presses to that fill's row of the surface table. The 1.5 pt transparent edge stays, so a press moves
    // nothing. (The surfaces themselves are exercised on the real Chip in `surfaceTone/pressFill.native.test.tsx`.)
    it('fills the pill with the press of the fill it rests on while pressed, in both schemes', () => {
        for (const scheme of ['light', 'dark'] as const) {
            const theme = themeFor(scheme);
            const rest = chipPill(theme, false, false, 'canvas');
            const pressed = chipPill(theme, false, true, 'canvas');

            expect(rest.backgroundColor, scheme).toBe(theme.colors.surfaceMuted);
            expect(pressed.backgroundColor, scheme).toBe(theme.press.muted);
            expect(pressed.borderWidth, scheme).toBe(1.5);
            // A press must be visible: the press is not the resting fill.
            expect(pressed.backgroundColor, scheme).not.toBe(rest.backgroundColor);
        }
    });

    it('rests on paper on a muted surface, pressing to the paper row', () => {
        for (const scheme of ['light', 'dark'] as const) {
            const theme = themeFor(scheme);

            expect(chipPill(theme, false, false, 'muted').backgroundColor, scheme).toBe(theme.colors.paper);
            expect(chipPill(theme, false, true, 'muted').backgroundColor, scheme).toBe(theme.press.paper);
        }
    });

    // REWRITTEN for parity item 10 (`componentFixes` §6): the selected pill used to be unchanged while pressed. It now
    // shows a 2 pt selectedEdge, with its inline padding half a point less so the box and the label stay where they were.
    it('shows a 2 pt selectedEdge while a selected chip is pressed, keeping the tint and the box size', () => {
        for (const scheme of ['light', 'dark'] as const) {
            const theme = themeFor(scheme);
            const rest = chipPill(theme, true, false, 'canvas');
            const pressed = chipPill(theme, true, true, 'canvas');

            expect(pressed.borderWidth, scheme).toBe(2);
            expect(pressed.borderColor, scheme).toBe(theme.colors.selectedEdge);
            expect(pressed.backgroundColor, scheme).toBe(rest.backgroundColor);
            expect(Number(pressed.paddingHorizontal) + Number(pressed.borderWidth), scheme).toBe(
                Number(rest.paddingHorizontal) + Number(rest.borderWidth),
            );
            expect(pressed.minHeight, scheme).toBe(rest.minHeight);
        }
    });

    it('holds the same 1.5 pt edge at rest (transparent) and selected, so selecting never resizes the pill', () => {
        const theme = themeFor('light');

        expect(chipPill(theme, false, false, 'canvas').borderWidth).toBe(1.5);
        expect(chipPill(theme, true, false, 'canvas').borderWidth).toBe(1.5);
        expect(chipPill(theme, false, false, 'canvas').borderColor).toBe('transparent');
    });

    it('paints the dark scheme from the dark roles', () => {
        const theme = themeFor('dark');

        expect(chipPill(theme, false, false, 'canvas').backgroundColor).toBe(roleDark.surfaceMuted);
        expect(chipLabel(theme, false).color).toBe(roleDark.ink);
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

    it('draws a 32pt pill inside a 44pt hit area on iOS, 48dp on Android', () => {
        for (const [os, hit] of [
            ['ios', '44px'],
            ['android', '48px'],
        ] as const) {
            withPlatformOs(os, () => {
                const { unmount } = render(<Chip kind="filter" label="Vegan" selected={false} onPress={vi.fn()} />);
                const chip = screen.getByRole('checkbox', { name: 'Vegan' });

                expect(getComputedStyle(chip).minHeight, os).toBe(hit);
                expect(getComputedStyle(pillOf(chip)).minHeight, os).toBe('32px');
                unmount();
            });
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

    it('cuts at the 24-character boundary: 24 whole, 25 to 23 plus an ellipsis, each named in full', () => {
        const exact = 'a'.repeat(24);
        const over = 'b'.repeat(25);
        const veryLong = 'c'.repeat(100);
        render(
            <>
                <Chip kind="filter" label={exact} selected={false} onPress={vi.fn()} />
                <Chip kind="filter" label={over} selected={false} onPress={vi.fn()} />
                <Chip kind="filter" label={veryLong} selected onPress={vi.fn()} />
            </>,
        );

        expect(within(screen.getByRole('checkbox', { name: exact })).getByText(exact)).toBeTruthy();
        expect(within(screen.getByRole('checkbox', { name: over })).getByText(`${'b'.repeat(23)}…`)).toBeTruthy();

        const longest = screen.getByRole('checkbox', { name: veryLong });

        expect(within(longest).getByText(`${'c'.repeat(23)}…`)).toBeTruthy();
        expect(longest.getAttribute('aria-checked')).toBe('true');
    });

    it('names a long chip in full with its count after it', () => {
        const long = 'd'.repeat(100);
        render(<Chip kind="filter" label={long} selected={false} count={3} onPress={vi.fn()} />);

        expect(screen.getByRole('checkbox', { name: `${long} 3` })).toBeTruthy();
    });

    it('never outgrows its row and clamps the label to two lines (320 dp at font scale 2)', () => {
        render(<Chip kind="filter" label={'e'.repeat(100)} selected={false} onPress={vi.fn()} />);

        const chip = screen.getByRole('checkbox');
        const label = within(chip).getByText(`${'e'.repeat(23)}…`);

        expect(getComputedStyle(chip).maxWidth).toBe('100%');
        expect(label.style.webkitLineClamp || getComputedStyle(label).webkitLineClamp).toBe('2');
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

    // The line that holds the chips wraps, not the group around it (`ChipRow.native.test.tsx` pins the structure).
    it('wraps the line that holds the chips when its overflow is wrap', () => {
        render(
            <ChipRow mode="filter" label="Diet" overflow="wrap">
                <Chip kind="filter" label="Vegan" selected={false} onPress={vi.fn()} />
            </ChipRow>,
        );
        const line = screen.getByRole('checkbox', { name: 'Vegan' }).parentElement;

        expect(line === null ? undefined : getComputedStyle(line).flexWrap).toBe('wrap');
    });
});
