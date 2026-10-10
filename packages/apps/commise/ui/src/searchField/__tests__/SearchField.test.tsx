import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { SearchField } from '../SearchField.js';
import type { SearchFieldProps } from '../props.js';

/**
 * SearchField (web) — spec §1.11: a 48 px pill, a 1 px `lineControl` edge on `paper`, a leading 20 px `search` glyph
 * (`inkMuted`, hidden), and while non-empty a trailing 44 × 44 clear control that returns focus to the field.
 */

afterEach(cleanup);

const tokensOf = (element: Element): readonly string[] => element.className.split(/\s+/u);

/** A search field that holds its own query, as a screen does. */
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

describe('SearchField (web)', () => {
    it('is a search box named by its visible label', () => {
        render(<Search />);

        const field = screen.getByRole('searchbox', { name: 'Search recipes' });

        expect(field.getAttribute('enterkeyhint')).toBe('search');
        expect(field.getAttribute('autocomplete')).toBe('off');
        expect(tokensOf(screen.getByText('Search recipes'))).not.toContain('sr-only');
    });

    it('keeps a hidden label as the field’s name, never only a placeholder', () => {
        render(<Search labelVisibility="hidden" placeholder="Lemon tart" />);

        expect(screen.getByRole('searchbox', { name: 'Search recipes' })).toBeTruthy();
        expect(tokensOf(screen.getByText('Search recipes'))).toContain('sr-only');
    });

    it('draws a 48px pill on the lineControl edge, with room for the glyph and the clear control', () => {
        render(<Search />);

        expect(tokensOf(screen.getByRole('searchbox'))).toEqual(
            expect.arrayContaining([
                'rounded-full',
                'min-h-12',
                'border',
                'border-line-control',
                'bg-paper',
                'text-body',
                'ps-11',
                'pe-12',
            ]),
        );
    });

    it('leads with a hidden search glyph in inkMuted', () => {
        const { container } = render(<Search />);
        const glyph = container.querySelector('svg.lucide-search');

        expect(glyph?.getAttribute('aria-hidden')).toBe('true');
        expect((glyph as SVGElement | null)?.style.color).toBe('var(--color-ink-muted)');
    });

    it('shows no clear control while empty', () => {
        render(<Search />);

        expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    });

    it('shows a 44px clear control while non-empty, which empties the field and puts focus back in it', async () => {
        const user = userEvent.setup();
        render(<Search initial="lemon" />);

        const clear = screen.getByRole('button', { name: 'Clear search' });

        expect(tokensOf(clear)).toEqual(expect.arrayContaining(['size-11']));

        await user.click(clear);

        const field = screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search recipes' });

        expect(field.value).toBe('');
        expect(document.activeElement).toBe(field);
        expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    });

    it('reports each edit', async () => {
        const user = userEvent.setup();
        const onChangeText = vi.fn();
        render(
            <SearchField
                id="s"
                label="Search"
                labelVisibility="hidden"
                clearLabel="Clear search"
                value=""
                onChangeText={onChangeText}
            />,
        );

        await user.type(screen.getByRole('searchbox'), 'p');

        expect(onChangeText).toHaveBeenCalledWith('p');
    });

    it('reports the search key as a submit', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        render(<Search onSubmit={onSubmit} />);

        await user.type(screen.getByRole('searchbox'), 'tart{Enter}');

        expect(onSubmit).toHaveBeenCalledOnce();
    });

    it('draws the focusRing on keyboard focus', () => {
        render(<Search />);

        expect(tokensOf(screen.getByRole('searchbox'))).toEqual(
            expect.arrayContaining(['focus-visible:ring-2', 'focus-visible:ring-focus-ring']),
        );
    });

    it('reports focus entering and leaving the field', async () => {
        const user = userEvent.setup();
        const onFocus = vi.fn();
        const onBlur = vi.fn();
        render(
            <>
                <Search onFocus={onFocus} onBlur={onBlur} />
                <button type="button">elsewhere</button>
            </>,
        );

        await user.click(screen.getByRole('searchbox'));

        expect(onFocus).toHaveBeenCalledOnce();

        await user.click(screen.getByRole('button', { name: 'elsewhere' }));

        expect(onBlur).toHaveBeenCalledOnce();
    });
});
