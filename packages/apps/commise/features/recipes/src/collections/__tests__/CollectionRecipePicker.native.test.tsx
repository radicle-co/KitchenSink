/**
 * The native add-recipes picker (`docs/design/uiOverhaul/buildSpec.md` §5.3): a full-height sheet "Add to {name}" with a sticky
 * search field, one checkbox row per recipe — the whole row toggles, named by the recipe — and a pinned **Done** that says
 * what changed ("Done · 2 added, 1 removed", a zero part left out). Each toggle saves at once, so × does what Done does.
 * Its body is whichever of the rows, a skeleton, or a load error the host's boundary renders; the field keeps its focus and
 * Done stays reachable in all of them.
 *
 * ⚠️ REWRITTEN for slice 5, replacing a page with an "Add" button per row, a separate heading and a text "Done". The
 * member badge, the per-row add state and the add-failed banner are gone with the page: a row is a checkbox that flips back
 * and says so when its toggle fails.
 */
import { makeRecipe } from '@kitchensink/recipe-core/testing';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';

import { CollectionPickerRow } from '../CollectionPickerRow.native.js';
import { CollectionRecipePicker } from '../CollectionRecipePicker.native.js';
import { CollectionRecipePickerCandidates } from '../CollectionRecipePickerCandidates.native.js';
import { CollectionRecipePickerLoadError } from '../CollectionRecipePickerLoadError.native.js';
import { CollectionRecipePickerLoading } from '../CollectionRecipePickerLoading.native.js';
import type { CollectionRecipePickerProps } from '../detailModel.js';

afterEach(cleanup);

const inLocale = (ui: React.ReactElement) => <LocaleProvider locale="en">{ui}</LocaleProvider>;

function picker(over: Partial<CollectionRecipePickerProps> = {}) {
    const props: CollectionRecipePickerProps = {
        open: true,
        onClose: vi.fn(),
        collectionName: 'Weeknight Dinners',
        query: '',
        onQueryChange: vi.fn(),
        summary: { added: 0, removed: 0 },
        children: <p>BODY</p>,
        ...over,
    };

    render(inLocale(<CollectionRecipePicker {...props} />));

    return props;
}

describe('CollectionRecipePicker (native) — the frame', () => {
    it('is a sheet titled “Add to {name}”, with the search field and the body', () => {
        picker();

        expect(screen.getByRole('heading', { name: 'Add to Weeknight Dinners' })).toBeTruthy();
        expect(screen.getByRole('textbox', { name: 'Search your recipes' })).toBeTruthy();
        expect(screen.getByText('BODY')).toBeTruthy();
    });

    it('draws nothing while shut', () => {
        picker({ open: false });

        expect(screen.queryByRole('heading', { name: 'Add to Weeknight Dinners' })).toBeNull();
    });

    it('reports what is typed, and clears the field from its own control', () => {
        const props = picker({ query: 'pas' });

        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'pasx' } });
        expect(props.onQueryChange).toHaveBeenCalledWith('pasx');

        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
        expect(props.onQueryChange).toHaveBeenLastCalledWith('');
    });

    it('says what changed on Done, leaving a zero part out', () => {
        picker({ summary: { added: 2, removed: 1 } });
        expect(screen.getByRole('button', { name: 'Done · 2 added, 1 removed' })).toBeTruthy();
        cleanup();

        picker({ summary: { added: 3, removed: 0 } });
        expect(screen.getByRole('button', { name: 'Done · 3 added' })).toBeTruthy();
        cleanup();

        picker();
        expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    });

    it('closes from Done and from × — each the same, because nothing is unsaved', () => {
        const props = picker();

        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(props.onClose).toHaveBeenCalledTimes(2);
    });

    it('announces a toggle politely, from a region that is always there', () => {
        picker();
        expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('');
        cleanup();

        picker({ announcement: { text: 'Added Pasta', occurrence: 1 } });
        expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('Added Pasta');
    });
});

function row(over: Partial<React.ComponentProps<typeof CollectionPickerRow>> = {}) {
    const props = {
        recipe: makeRecipe({ id: 'rec_1', title: 'Pasta', cuisine: 'Italian', totalTimeMinutes: 25 }),
        checked: false,
        onToggle: vi.fn(),
        ...over,
    };

    render(inLocale(<CollectionPickerRow {...props} />));

    return props;
}

describe('CollectionPickerRow (native)', () => {
    it('is one checkbox named by the recipe, and the whole row toggles it', () => {
        const props = row();
        const box = screen.getByRole('checkbox', { name: 'Pasta' });

        expect(box.getAttribute('aria-checked')).toBe('false');

        fireEvent.click(screen.getByText('Italian · 25 min'));

        expect(props.onToggle).toHaveBeenCalledExactlyOnceWith(true);
    });

    it('shows a member checked, and asks to remove it when pressed', () => {
        const props = row({ checked: true });
        const box = screen.getByRole('checkbox', { name: 'Pasta' });

        expect(box.getAttribute('aria-checked')).toBe('true');

        fireEvent.click(box);

        expect(props.onToggle).toHaveBeenCalledExactlyOnceWith(false);
    });

    it('says the title, the cuisine and the time', () => {
        row();

        expect(screen.getByText('Pasta')).toBeTruthy();
        expect(screen.getByText('Italian · 25 min')).toBeTruthy();
    });

    it('says a refused add in an alert naming the recipe, and a refused remove the same way', () => {
        row({ failed: 'add' });
        expect(screen.getByRole('alert').textContent).toBe('Couldn’t add Pasta. Try again.');
        cleanup();

        row({ failed: 'remove' });
        expect(screen.getByRole('alert').textContent).toBe('Couldn’t remove Pasta. Try again.');
    });

    it('draws no alert otherwise', () => {
        row();

        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('keeps every toggle reaching the host in order when pressed quickly, flipping from the shown state each time', () => {
        const calls: boolean[] = [];

        function Flipper() {
            const [checked, setChecked] = useState(false);

            return (
                <CollectionPickerRow
                    recipe={makeRecipe({ id: 'rec_1', title: 'Pasta' })}
                    checked={checked}
                    onToggle={(next) => {
                        calls.push(next);
                        setChecked(next);
                    }}
                />
            );
        }

        render(inLocale(<Flipper />));
        const box = screen.getByRole('checkbox', { name: 'Pasta' });

        fireEvent.click(box);
        fireEvent.click(box);
        fireEvent.click(box);

        expect(calls).toEqual([true, false, true]);
    });
});

function candidates(over: Partial<React.ComponentProps<typeof CollectionRecipePickerCandidates>> = {}) {
    const props = {
        recipes: [makeRecipe({ id: 'rec_1', title: 'Pasta' }), makeRecipe({ id: 'rec_2', title: 'Soup' })],
        query: '',
        onClearSearch: vi.fn(),
        onCreateRecipe: vi.fn(),
        renderRow: (recipe: { id: string; title: string }) => <p key={recipe.id}>{`row ${recipe.title}`}</p>,
        ...over,
    };

    render(inLocale(<CollectionRecipePickerCandidates {...props} />));

    return props;
}

describe('CollectionRecipePickerCandidates (native)', () => {
    it('draws one list item per recipe, each the host’s row', () => {
        candidates();

        expect(screen.getAllByRole('listitem')).toHaveLength(2);
        expect(screen.getByText('row Pasta')).toBeTruthy();
        expect(screen.getByText('row Soup')).toBeTruthy();
    });

    it('with no recipes at all: says so and offers Add a recipe, which opens the editor', () => {
        const props = candidates({ recipes: [] });

        expect(screen.getByText('You have no recipes yet.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Add a recipe' }));

        expect(props.onCreateRecipe).toHaveBeenCalledOnce();
    });

    it('with a search that matched none: says so and offers Clear search', () => {
        const props = candidates({ recipes: [], query: 'zzz' });

        expect(screen.getByText('No recipes match your search')).toBeTruthy();
        expect(screen.queryByText('You have no recipes yet.')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

        expect(props.onClearSearch).toHaveBeenCalledOnce();
    });
});

describe('the picker’s other bodies (native)', () => {
    it('loading: a status that says what is loading, over six skeleton rows that stop being decorative to no one', () => {
        render(inLocale(<CollectionRecipePickerLoading />));
        const status = screen.getByRole('status');

        expect(status.textContent).toContain('Loading your recipes');
        expect(status.querySelectorAll('[aria-hidden="true"] > *, [aria-hidden="true"]').length).toBeGreaterThanOrEqual(
            6,
        );
    });

    it('load error: an alert with a Try again that retries', () => {
        const onRetry = vi.fn();
        render(inLocale(<CollectionRecipePickerLoadError onRetry={onRetry} />));

        expect(screen.getByRole('alert').textContent).toContain('We couldn’t load your recipes.');

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledOnce();
    });
});
