import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { Chip } from '../Chip.js';
import { ChipRow } from '../ChipRow.js';
import type { ChipOption } from '../props.js';

/**
 * Chip and ChipRow (web) — `docs/design/uiOverhaul/buildSpec.md` §1.10/§1.11. The state matrix: `paper` with a
 * `lineControl` edge and an `ink` label at rest, `pearl` on hover and press, and when selected the `selectedFill` tint,
 * a 1.5 px `selectedEdge`, an `actionText` label AND a 16 px check before it — so selection never rests on colour alone
 * (SC 1.4.1). jsdom lays nothing out, so the state matrix is pinned on the class contract.
 */

afterEach(cleanup);

const tokensOf = (element: Element): readonly string[] => element.className.split(/\s+/u);

/** The Lucide glyph drawn inside an element, or `null`. */
const glyphIn = (element: Element): string | null =>
    [...(element.querySelector('svg.lucide')?.classList ?? [])].find((token) => /^lucide-./u.test(token)) ?? null;

describe('Chip (web) — filter', () => {
    it('is a toggle button whose pressed state follows selected', () => {
        const { rerender } = render(<Chip kind="filter" label="Vegan" selected={false} onPress={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Vegan' }).getAttribute('aria-pressed')).toBe('false');

        rerender(<Chip kind="filter" label="Vegan" selected onPress={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Vegan' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('calls onPress when pressed', async () => {
        const user = userEvent.setup();
        const onPress = vi.fn();
        render(<Chip kind="filter" label="Vegan" selected={false} onPress={onPress} />);

        await user.click(screen.getByRole('button', { name: 'Vegan' }));

        expect(onPress).toHaveBeenCalledOnce();
    });

    it('rests on paper with a lineControl edge and an ink label, pearl on hover and press', () => {
        render(<Chip kind="filter" label="Vegan" selected={false} onPress={vi.fn()} />);

        expect(tokensOf(screen.getByRole('button', { name: 'Vegan' }))).toEqual(
            expect.arrayContaining([
                'bg-paper',
                'border-line-control',
                'text-ink',
                'hover:bg-ink/6',
                'active:bg-ink/6',
                'rounded-full',
                'min-h-9',
                'focus-visible:ring-focus-ring',
                'disabled:opacity-40',
            ]),
        );
    });

    it('shows selection by tint, a 1.5 px edge, the actionText label AND a check — never colour alone', () => {
        render(<Chip kind="filter" label="Vegan" selected onPress={vi.fn()} />);

        const chip = screen.getByRole('button', { name: 'Vegan' });

        expect(tokensOf(chip)).toEqual(
            expect.arrayContaining(['bg-selected-fill', 'border-[1.5px]', 'border-selected-edge', 'text-action-text']),
        );
        expect(tokensOf(chip)).not.toContain('bg-paper');
        expect(glyphIn(chip)).toBe('lucide-check');
        expect(chip.querySelector('svg.lucide')?.getAttribute('width')).toBe('16');
    });

    it('draws no check while unselected', () => {
        render(<Chip kind="filter" label="Vegan" selected={false} onPress={vi.fn()} />);

        expect(glyphIn(screen.getByRole('button', { name: 'Vegan' }))).toBeNull();
    });

    it('keeps a 44px hit area on a coarse pointer around its 36px pill', () => {
        render(<Chip kind="filter" label="Vegan" selected={false} onPress={vi.fn()} />);

        expect(tokensOf(screen.getByRole('button', { name: 'Vegan' }))).toEqual(
            expect.arrayContaining([
                'relative',
                "before:content-['']",
                'before:absolute',
                'pointer-coarse:before:-inset-y-1',
            ]),
        );
    });

    it('shows a count after the label in tabular inkMuted digits, inside the accessible name', () => {
        render(<Chip kind="filter" label="Vegan" selected={false} count={12} onPress={vi.fn()} />);

        const count = screen.getByText('12');

        expect(tokensOf(count)).toEqual(expect.arrayContaining(['tabular-nums', 'text-ink-muted']));
        expect(screen.getByRole('button', { name: 'Vegan 12' })).toBeTruthy();
    });

    it('truncates a label over 24 characters, keeping the full label as its name', () => {
        const long = 'Gluten-free and dairy-free options';
        render(<Chip kind="filter" label={long} selected={false} onPress={vi.fn()} />);

        const chip = screen.getByRole('button', { name: long });

        expect(within(chip).getByText('Gluten-free and dairy-f…')).toBeTruthy();
    });
});

describe('Chip (web) — input', () => {
    it('is a button named by its remove label, with a trailing x and no pressed state', () => {
        render(<Chip kind="input" label="Vegan" removeLabel="Remove Vegan" onRemove={vi.fn()} />);

        const chip = screen.getByRole('button', { name: 'Remove Vegan' });

        expect(chip.hasAttribute('aria-pressed')).toBe(false);
        expect(glyphIn(chip)).toBe('lucide-x');
        expect(within(chip).getByText('Vegan')).toBeTruthy();
    });

    it('removes itself when pressed', async () => {
        const user = userEvent.setup();
        const onRemove = vi.fn();
        render(<Chip kind="input" label="Vegan" removeLabel="Remove Vegan" onRemove={onRemove} />);

        await user.click(screen.getByRole('button', { name: 'Remove Vegan' }));

        expect(onRemove).toHaveBeenCalledOnce();
    });
});

const DIFFICULTY: readonly ChipOption[] = [
    { value: 'easy', label: 'Easy' },
    { value: 'medium', label: 'Medium' },
    { value: 'hard', label: 'Hard' },
];

/** A choice row that holds its own value, as a screen does. */
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

describe('ChipRow (web) — choice', () => {
    it('is a radio group named by its label, one radio per option', () => {
        render(<Choice />);

        const group = screen.getByRole('radiogroup', { name: 'Difficulty' });

        expect(
            within(group)
                .getAllByRole('radio')
                .map((radio) => radio.textContent),
        ).toEqual(['Easy', 'Medium', 'Hard']);
    });

    it('checks the chosen option, and shows it as a selected chip with a check', () => {
        render(<Choice initial="medium" />);

        const medium = screen.getByRole('radio', { name: 'Medium' });

        expect(medium.getAttribute('aria-checked')).toBe('true');
        expect(screen.getByRole('radio', { name: 'Easy' }).getAttribute('aria-checked')).toBe('false');
        expect(tokensOf(medium)).toContain('bg-selected-fill');
        expect(glyphIn(medium)).toBe('lucide-check');
    });

    it('chooses an option on click', async () => {
        const user = userEvent.setup();
        render(<Choice />);

        await user.click(screen.getByRole('radio', { name: 'Hard' }));

        expect(screen.getByRole('radio', { name: 'Hard' }).getAttribute('aria-checked')).toBe('true');
    });

    it('moves the choice with the arrow keys', async () => {
        const user = userEvent.setup();
        render(<Choice initial="easy" />);

        await user.click(screen.getByRole('radio', { name: 'Easy' }));
        // Held, not tapped: Radix moves focus on a timeout and chooses the focused radio only while an arrow key is
        // down, and a tap's keyup would land before the timeout under user-event's zero delay.
        await user.keyboard('{ArrowRight>}');
        await waitFor(() =>
            expect(screen.getByRole('radio', { name: 'Medium' }).getAttribute('aria-checked')).toBe('true'),
        );
        await user.keyboard('{/ArrowRight}');

        expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Medium' }));
    });

    it('keeps a choice when its option is pressed again, unless the row is clearable', async () => {
        const user = userEvent.setup();
        render(<Choice initial="easy" />);

        await user.click(screen.getByRole('radio', { name: 'Easy' }));

        expect(screen.getByRole('radio', { name: 'Easy' }).getAttribute('aria-checked')).toBe('true');
    });

    it('clears a clearable row’s choice when its option is pressed again', async () => {
        const user = userEvent.setup();
        render(<Choice clearable initial="easy" />);

        await user.click(screen.getByRole('radio', { name: 'Easy' }));

        expect(screen.getAllByRole('radio').every((radio) => radio.getAttribute('aria-checked') === 'false')).toBe(
            true,
        );
    });

    it('moves a clearable row’s choice with the arrow keys too', async () => {
        const user = userEvent.setup();
        render(<Choice clearable initial="easy" />);

        screen.getByRole('radio', { name: 'Easy' }).focus();
        await user.keyboard('{ArrowRight}{Enter}');

        expect(screen.getByRole('radio', { name: 'Medium' }).getAttribute('aria-checked')).toBe('true');
    });

    // ⚠️ The blueprint expected `aria-pressed` here. Radix's single ToggleGroup renders a `radiogroup` of `radio`s with
    // `aria-checked` — a radio that can be cleared — and this pins what it really emits.
    it('names a clearable row as a radio group too (Radix ToggleGroup single), not as pressed buttons', () => {
        render(<Choice clearable />);

        const group = screen.getByRole('radiogroup', { name: 'Difficulty' });

        expect(within(group).getAllByRole('radio')).toHaveLength(3);
        expect(within(group).queryAllByRole('button')).toHaveLength(0);
    });
});

describe('ChipRow (web) — filter and input', () => {
    it('is a group named by its label, holding the chips it is given', () => {
        render(
            <ChipRow mode="filter" label="Diet" overflow="wrap">
                <Chip kind="filter" label="Vegan" selected={false} onPress={vi.fn()} />
                <Chip kind="filter" label="Halal" selected onPress={vi.fn()} />
            </ChipRow>,
        );

        const group = screen.getByRole('group', { name: 'Diet' });

        expect(within(group).getAllByRole('button')).toHaveLength(2);
    });

    it('scrolls one line inside itself, snapping, with trailing room and a fade at the end', () => {
        render(
            <ChipRow mode="input" label="Applied filters" overflow="scroll">
                <Chip kind="input" label="Vegan" removeLabel="Remove Vegan" onRemove={vi.fn()} />
            </ChipRow>,
        );

        expect(tokensOf(screen.getByRole('group', { name: 'Applied filters' }))).toEqual(
            expect.arrayContaining(['flex-nowrap', 'overflow-x-auto', 'snap-x', 'snap-proximity', 'pe-4']),
        );
    });

    it('wraps to further lines when its overflow is wrap', () => {
        render(
            <ChipRow mode="filter" label="Diet" overflow="wrap">
                <Chip kind="filter" label="Vegan" selected={false} onPress={vi.fn()} />
            </ChipRow>,
        );

        expect(tokensOf(screen.getByRole('group', { name: 'Diet' }))).toContain('flex-wrap');
        expect(tokensOf(screen.getByRole('group', { name: 'Diet' }))).not.toContain('overflow-x-auto');
    });
});
