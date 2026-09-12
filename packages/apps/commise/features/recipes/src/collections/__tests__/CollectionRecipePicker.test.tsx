// @vitest-environment jsdom
/**
 * Component tests for the web collection recipe-picker — the ADD half of FR-009 (T072). The picker is a frame
 * (heading, Done, search) around one of three bodies: the loading body, the load-error body, or the settled
 * candidates. Covers every branch: loading, load error + retry, empty (the caller owns no recipes), no-matches (a search
 * that narrows everything out — a DIFFERENT state to "no recipes"), populated, already-a-member, in-flight,
 * the post-add status announcement, and the add-failure alert.
 *
 * The member/in-flight rows assert `aria-disabled` (NOT the `disabled` attribute) and that the control stays
 * focusable and mounted: the row's button must never unmount on activation, or the keyboard user's focus is
 * dropped to `<body>` mid-flow. Handler-suppression is asserted too, so making the control merely LOOK
 * inert would fail.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ringContrast, utilityContrast } from '@commise/test-utils';
import { semantic } from '@commise/ui';

import { CollectionRecipePicker } from '../CollectionRecipePicker.js';
import { CollectionRecipePickerCandidates } from '../CollectionRecipePickerCandidates.js';
import { CollectionRecipePickerLoadError } from '../CollectionRecipePickerLoadError.js';
import { CollectionRecipePickerLoading } from '../CollectionRecipePickerLoading.js';
import type { CollectionRecipePickerCandidatesProps, CollectionRecipePickerProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

const RECIPES = [
    { id: 'rec_1', title: 'Weeknight Pasta', totalTimeMinutes: 30, updatedAt: '2026-04-19T09:30:00.000Z' },
    { id: 'rec_2', title: 'Sheet-Pan Chicken', totalTimeMinutes: 45, updatedAt: '2026-04-18T09:30:00.000Z' },
] as const;

type FrameProps = Omit<CollectionRecipePickerProps, 'children'>;

/** The frame's props, with the fixture collection and inert callbacks. */
function frameProps(overrides: Partial<FrameProps> = {}): FrameProps {
    return { collectionName: 'Weeknight Dinners', query: '', onQueryChange: noop, onDone: noop, ...overrides };
}

/** Render the frame around the settled candidates. */
function renderPicker(overrides: Partial<FrameProps & CollectionRecipePickerCandidatesProps> = {}) {
    const { collectionName, onQueryChange, onDone, ...candidates } = overrides;
    const frame = frameProps({
        ...(collectionName === undefined ? {} : { collectionName }),
        ...(onQueryChange === undefined ? {} : { onQueryChange }),
        ...(onDone === undefined ? {} : { onDone }),
        ...(candidates.query === undefined ? {} : { query: candidates.query }),
    });
    render(
        <CollectionRecipePicker {...frame}>
            <CollectionRecipePickerCandidates
                recipes={RECIPES}
                memberRecipeIds={[]}
                query={frame.query}
                onAdd={noop}
                onCreateRecipe={noop}
                {...candidates}
            />
        </CollectionRecipePicker>,
    );
}

/** Render the frame around the loading body. */
function renderLoading() {
    render(
        <CollectionRecipePicker {...frameProps()}>
            <CollectionRecipePickerLoading />
        </CollectionRecipePicker>,
    );
}

/** Render the frame around the load-error body. */
function renderLoadError(onRetry: () => void = noop) {
    render(
        <CollectionRecipePicker {...frameProps()}>
            <CollectionRecipePickerLoadError onRetry={onRetry} />
        </CollectionRecipePicker>,
    );
}

describe('CollectionRecipePicker (web) — chrome', () => {
    it('names the collection it adds to in the heading', () => {
        renderPicker({ collectionName: 'Holiday Baking' });

        expect(screen.getByRole('heading', { level: 1, name: 'Add recipes to Holiday Baking' })).toBeTruthy();
    });

    it('reports search input upward', async () => {
        const user = userEvent.setup();
        const onQueryChange = vi.fn();
        renderPicker({ onQueryChange });

        // This is a controlled input backed by a `vi.fn()` onChange (no state update between keystrokes), so
        // `user.type` would fire once per character with the char alone, never the full string — paste
        // fires a single change event with the whole value, matching the "one edit" intent of this test.
        const input = screen.getByLabelText('Search your recipes');
        await user.click(input);
        await user.paste('pasta');

        expect(onQueryChange).toHaveBeenCalledWith('pasta');
    });

    it('reflects the query value it is given (controlled)', () => {
        renderPicker({ query: 'chicken' });

        expect((screen.getByLabelText('Search your recipes') as HTMLInputElement).value).toBe('chicken');
    });

    it('reports done upward', async () => {
        const user = userEvent.setup();
        const onDone = vi.fn();
        renderPicker({ onDone });

        await user.click(screen.getByRole('button', { name: 'Done' }));

        expect(onDone).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionRecipePicker (web) — fetch states', () => {
    it('shows a busy status and no rows while loading', () => {
        renderLoading();

        expect(screen.getByRole('status', { name: 'Loading your recipes' })).toBeTruthy();
        expect(screen.queryByRole('list')).toBeNull();
        // The frame is the same in every state: the search field and Done stay put while the body changes.
        expect(screen.getByRole('searchbox', { name: 'Search your recipes' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    });

    it('announces the localized loading label as the live region CONTENT, not only its aria-label', () => {
        renderLoading();

        // A `role="status"` node rendered EMPTY is doubly broken: it is zero-height (nothing for a sighted
        // viewer, and Playwright resolves it as `hidden`) AND it is silent, because a live region announces
        // its CONTENT, not its label. The label must therefore be the visible caption.
        expect(screen.getByRole('status', { name: 'Loading your recipes' }).textContent).toContain(
            'Loading your recipes',
        );
    });

    it('shows an alert and retries on request when the load fails', async () => {
        const user = userEvent.setup();
        const onRetry = vi.fn();
        renderLoadError(onRetry);

        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.queryByRole('list')).toBeNull();
        expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('offers to create a recipe when the caller owns none', async () => {
        const user = userEvent.setup();
        const onCreateRecipe = vi.fn();
        renderPicker({ recipes: [], query: '', onCreateRecipe });

        expect(screen.getByText('No recipes yet')).toBeTruthy();
        expect(screen.queryByRole('list')).toBeNull();

        await user.click(screen.getByRole('button', { name: 'New recipe' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
    });

    it('distinguishes a search with no matches from owning no recipes', () => {
        renderPicker({ recipes: [], query: 'zzz' });

        expect(screen.getByText('No recipes match your search')).toBeTruthy();
        // The create CTA belongs to the "no recipes at all" state — offering it here would be wrong: the
        // user HAS recipes, their search just matched none.
        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
        expect(screen.queryByText('No recipes yet')).toBeNull();
    });
});

describe('CollectionRecipePicker (web) — adding', () => {
    it('renders one row per candidate recipe', () => {
        renderPicker();

        const list = screen.getByRole('list');
        expect(within(list).getAllByRole('listitem')).toHaveLength(2);
        expect(screen.getByRole('button', { name: 'Add Weeknight Pasta' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Add Sheet-Pan Chicken' })).toBeTruthy();
    });

    it('reports the added recipe id upward', async () => {
        const user = userEvent.setup();
        const onAdd = vi.fn();
        renderPicker({ onAdd });

        await user.click(screen.getByRole('button', { name: 'Add Sheet-Pan Chicken' }));

        expect(onAdd).toHaveBeenCalledWith('rec_2');
    });

    it('marks a member row in TEXT (not colour alone) and offers no add control for it', () => {
        renderPicker({ memberRecipeIds: ['rec_1'] });

        expect(screen.getByText('In this collection')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Add Weeknight Pasta' })).toBeNull();
        // The non-member row is unaffected — membership is per row, not per screen.
        expect(screen.getByRole('button', { name: 'Add Sheet-Pan Chicken' })).toBeTruthy();
    });

    it('keeps a member row control mounted, focusable and aria-disabled, and suppresses re-adds', async () => {
        const user = userEvent.setup();
        const onAdd = vi.fn();
        renderPicker({ memberRecipeIds: ['rec_1'], onAdd });

        const control = screen.getByRole('button', { name: 'Weeknight Pasta is in this collection' });

        expect(control.getAttribute('aria-disabled')).toBe('true');
        // NOT the `disabled` attribute: a disabled button is removed from the tab order, so a keyboard user
        // who just activated it would lose focus to <body>.
        expect((control as HTMLButtonElement).disabled).toBe(false);

        await user.click(control);

        expect(onAdd).not.toHaveBeenCalled();
    });

    it('marks the in-flight row as busy and suppresses duplicate submissions', async () => {
        const user = userEvent.setup();
        const onAdd = vi.fn();
        renderPicker({ pendingRecipeId: 'rec_1', onAdd });

        const control = screen.getByRole('button', { name: 'Add Weeknight Pasta' });

        expect(within(control).getByText('Adding…')).toBeTruthy();
        expect(control.getAttribute('aria-disabled')).toBe('true');
        expect((control as HTMLButtonElement).disabled).toBe(false);

        await user.click(control);

        expect(onAdd).not.toHaveBeenCalled();
        // Other rows stay live while one add is in flight.
        await user.click(screen.getByRole('button', { name: 'Add Sheet-Pan Chicken' }));
        expect(onAdd).toHaveBeenCalledWith('rec_2');
    });

    it('announces a successful add politely (WCAG 4.1.3 status message)', () => {
        renderPicker({ memberRecipeIds: ['rec_1'], lastAddedRecipeId: 'rec_1' });

        expect(screen.getByRole('status').textContent).toContain('Added Weeknight Pasta');
    });

    it('announces nothing when no add has succeeded', () => {
        renderPicker();

        expect(screen.queryByRole('status')).toBeNull();
    });

    it('surfaces an add failure as an alert without hiding the rows', () => {
        renderPicker({ addFailed: true });

        expect(screen.getByRole('alert').textContent).toContain('We couldn’t add that recipe. Please try again.');
        // The failure is per-add, not per-screen: the user must still be able to retry from the row.
        expect(screen.getByRole('button', { name: 'Add Weeknight Pasta' })).toBeTruthy();
    });

    it('tints the add-failure alert with the error token, never coral', () => {
        renderPicker({ addFailed: true });
        const className = screen.getByRole('alert').className;

        // The banner labelled itself `text-error-dark` (#B1442B) but filled with `bg-coral/10` (#E8917A): two
        // adjacent-but-different hues in one element, and coral is a brand ACCENT, not the failure register.
        expect(className).toContain('text-error-dark');
        expect(className).toContain('bg-error/10');
        expect(className).not.toContain('coral');
    });
});

/**
 * The picker's two bare TEXT controls (Done, Retry) are read, so they carry the 4.5:1 body-text floor — not
 * the 3:1 accent floor `seafoam` clears. Both painted `text-seafoam`: 4.02:1 on the white card at rest and
 * 3.57:1 the moment `hover:bg-seafoam/10` lands, so the pointer alone made a failing label worse. `@commise/ui`'s
 * palette JSDoc states once, authoritatively, where seafoam IS still the right token.
 *
 * The ratio is MEASURED off the rendered class list rather than asserted as a spelling: an
 * `expect(className).toContain('text-ocean-dark')` would keep passing if the palette re-themed that token to
 * near-white.
 */
describe('CollectionRecipePicker (web) — text controls clear the AA body-text floor', () => {
    it('keeps the Done control legible at rest AND over its hover tint', () => {
        renderPicker();
        const done = screen.getByRole('button', { name: 'Done' });

        expect(utilityContrast(done.className), 'Done at rest').toBeGreaterThanOrEqual(4.5);
        expect(utilityContrast(done.className, { variant: 'hover' }), 'Done on hover').toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the load-error Retry control legible at rest AND over its hover tint', () => {
        renderLoadError();
        const retry = screen.getByRole('button', { name: 'Try again' });

        expect(utilityContrast(retry.className), 'Retry at rest').toBeGreaterThanOrEqual(4.5);
        expect(utilityContrast(retry.className, { variant: 'hover' }), 'Retry on hover').toBeGreaterThanOrEqual(4.5);
    });
});

/**
 * The picker is a `<section>` on the app background (it paints no surface of its own), so that is the backdrop
 * its search field's focus ring is drawn on — not the field's own white fill, because a Tailwind ring is a
 * spread box-shadow OUTSIDE the border box.
 *
 * The ring shipped as `ring-seafoam-light` (2.58:1), under the 3:1 SC 1.4.11 floor (#114).
 */
describe('CollectionRecipePicker (web) — the search field’s focus ring clears the 3:1 SC 1.4.11 floor', () => {
    it('rings the search box legibly against the page it sits on', () => {
        renderPicker();

        const search = screen.getByRole('searchbox', { name: 'Search your recipes' });

        expect(search.className, 'the browser outline is suppressed, so the ring is the whole indicator') //
            .toContain('outline-none');
        expect(
            ringContrast(search.className, { surface: semantic.background }),
            'picker-search focus ring',
        ).toBeGreaterThanOrEqual(3);
    });

    it('out-measures the `seafoam-light` it replaced', () => {
        renderPicker();

        expect(
            ringContrast(screen.getByRole('searchbox', { name: 'Search your recipes' }).className, {
                surface: semantic.background,
            }),
        ).toBeGreaterThan(ringContrast('ring-2 ring-seafoam-light', { surface: semantic.background }));
    });
});
