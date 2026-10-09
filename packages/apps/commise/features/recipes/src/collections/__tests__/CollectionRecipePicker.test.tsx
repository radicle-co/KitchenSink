// @vitest-environment jsdom
/**
 * The add-recipes picker (`docs/design/uiOverhaul/buildSpec.md` §5.3): a full-height sheet "Add to {name}" with a sticky
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
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';

import { CollectionPickerRow } from '../CollectionPickerRow.js';
import { CollectionRecipePicker } from '../CollectionRecipePicker.js';
import { CollectionRecipePickerCandidates } from '../CollectionRecipePickerCandidates.js';
import { CollectionRecipePickerLoadError } from '../CollectionRecipePickerLoadError.js';
import { CollectionRecipePickerLoading } from '../CollectionRecipePickerLoading.js';
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

describe('CollectionRecipePicker (web) — the frame', () => {
    it('is a dialog titled “Add to {name}”, with the search field and the body', () => {
        picker();
        const dialog = screen.getByRole('dialog', { name: 'Add to Weeknight Dinners' });

        expect(within(dialog).getByRole('searchbox', { name: 'Search your recipes' })).toBeTruthy();
        expect(within(dialog).getByText('BODY')).toBeTruthy();
    });

    it('draws nothing while shut', () => {
        picker({ open: false });

        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('reports what is typed, and clears the field from its own control', async () => {
        const user = userEvent.setup();
        const props = picker({ query: 'pas' });

        await user.type(screen.getByRole('searchbox'), 'x');
        expect(props.onQueryChange).toHaveBeenCalledWith('pasx');

        await user.click(screen.getByRole('button', { name: 'Clear search' }));
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

    it('closes from Done, from ×, and from Escape — each the same, because nothing is unsaved', async () => {
        const user = userEvent.setup();
        const props = picker();

        await user.click(screen.getByRole('button', { name: 'Done' }));
        await user.click(screen.getByRole('button', { name: 'Close' }));
        await user.keyboard('{Escape}');

        expect(props.onClose).toHaveBeenCalledTimes(3);
    });

    it('announces a toggle politely, from a region that is always there', () => {
        picker();
        const region = screen.getAllByRole('status').find((node) => node.classList.contains('sr-only'));

        expect(region?.textContent).toBe('');
        cleanup();

        picker({ announcement: { text: 'Added Pasta', occurrence: 1 } });
        expect(screen.getAllByRole('status').some((node) => node.textContent === 'Added Pasta')).toBe(true);
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

describe('CollectionPickerRow (web)', () => {
    it('is one checkbox named by the recipe, and the whole row toggles it', async () => {
        const user = userEvent.setup();
        const props = row();
        const box = screen.getByRole('checkbox', { name: 'Pasta' });

        expect(box.getAttribute('aria-checked')).toBe('false');

        await user.click(screen.getByText('Italian · 25 min').closest('[role="checkbox"]') as HTMLElement);

        expect(props.onToggle).toHaveBeenCalledExactlyOnceWith(true);
    });

    it('shows a member checked, and asks to remove it when pressed', async () => {
        const user = userEvent.setup();
        const props = row({ checked: true });
        const box = screen.getByRole('checkbox', { name: 'Pasta' });

        expect(box.getAttribute('aria-checked')).toBe('true');

        await user.click(box);

        expect(props.onToggle).toHaveBeenCalledExactlyOnceWith(false);
    });

    it('toggles from the keyboard with Space, and is in the tab order', async () => {
        const user = userEvent.setup();
        const props = row();

        await user.tab();
        expect(document.activeElement).toBe(screen.getByRole('checkbox'));

        await user.keyboard(' ');

        expect(props.onToggle).toHaveBeenCalledExactlyOnceWith(true);
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

    it('keeps every toggle reaching the host in order when pressed quickly, flipping from the shown state each time', async () => {
        const user = userEvent.setup();
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

        await user.click(box);
        await user.click(box);
        await user.click(box);

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

describe('CollectionRecipePickerCandidates (web)', () => {
    it('draws one list item per recipe, each the host’s row', () => {
        candidates();

        expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(2);
        expect(screen.getByText('row Pasta')).toBeTruthy();
        expect(screen.getByText('row Soup')).toBeTruthy();
    });

    it('with no recipes at all: says so and offers Add a recipe, which opens the editor', async () => {
        const user = userEvent.setup();
        const props = candidates({ recipes: [] });

        expect(screen.getByText('You have no recipes yet.')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Add a recipe' }));

        expect(props.onCreateRecipe).toHaveBeenCalledOnce();
    });

    it('with a search that matched none: says so and offers Clear search', async () => {
        const user = userEvent.setup();
        const props = candidates({ recipes: [], query: 'zzz' });

        expect(screen.getByText('No recipes match your search')).toBeTruthy();
        expect(screen.queryByText('You have no recipes yet.')).toBeNull();

        await user.click(screen.getByRole('button', { name: 'Clear search' }));

        expect(props.onClearSearch).toHaveBeenCalledOnce();
    });
});

describe('the picker’s other bodies (web)', () => {
    it('loading: a status that says what is loading, over six skeleton rows that stop being decorative to no one', () => {
        render(inLocale(<CollectionRecipePickerLoading />));
        const status = screen.getByRole('status');

        expect(status.textContent).toContain('Loading your recipes');
        expect(status.querySelectorAll('[aria-hidden="true"] > *, [aria-hidden="true"]').length).toBeGreaterThanOrEqual(
            6,
        );
    });

    it('load error: an alert with a Try again that retries', async () => {
        const user = userEvent.setup();
        const onRetry = vi.fn();
        render(inLocale(<CollectionRecipePickerLoadError onRetry={onRetry} />));

        expect(screen.getByRole('alert').textContent).toContain('We couldn’t load your recipes.');

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledOnce();
    });
});
