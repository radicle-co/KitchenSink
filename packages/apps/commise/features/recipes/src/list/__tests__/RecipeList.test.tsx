// @vitest-environment jsdom
/**
 * Component tests for the web recipe-list view. Covers EVERY UI state the testing mandate requires —
 * loading, error, empty, and populated — plus the persistent chrome (heading, search, create) and the
 * interaction contracts (search change, select, create, retry). Assertions are on role/name/text and on
 * mock-call arguments, so a wrong state branch or a dropped handler argument fails the test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';

import { ringContrast, utilityContrast } from '@commise/test-utils';
import { semantic } from '@commise/ui';

import { makeRecipeListItem } from '../../__fixtures__/index.js';
import { RecipeList } from '../RecipeList.js';
import type { RecipeListViewProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function renderList(overrides: Partial<RecipeListViewProps> = {}) {
    const props: RecipeListViewProps = {
        status: 'ready',
        recipes: [],
        searchValue: '',
        onSearchChange: noop,
        onSelectRecipe: noop,
        onCreateRecipe: noop,
        onRetry: noop,
        ...overrides,
    };
    render(<RecipeList {...props} />);

    return props;
}

/** The source switcher's destinations — the web app's real `/{locale}/…` pair. */
const HREF = { mine: '/en/recipes', community: '/en/discover' } as const;

const threeRecipes = [
    makeRecipeListItem({ id: 'rec_1', title: 'Mediterranean Grilled Lamb', totalTimeMinutes: 45 }),
    makeRecipeListItem({ id: 'rec_2', title: 'Asparagus with Green Sauce', totalTimeMinutes: 20 }),
    makeRecipeListItem({ id: 'rec_3', title: 'Gourmet Garden Salad', totalTimeMinutes: 15 }),
];

describe('RecipeList (web) — chrome', () => {
    it('always renders the heading, search box, and create action', () => {
        renderList({ status: 'loading' });

        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
        expect(screen.getByRole('searchbox', { name: 'Search recipes' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'New recipe' })).toBeTruthy();
    });

    it('reflects the controlled search value', () => {
        renderList({ searchValue: 'risotto' });

        expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('risotto');
    });

    it('reports search input changes upward', () => {
        const onSearchChange = vi.fn();
        renderList({ onSearchChange });

        // Kept as fireEvent.change (not user.type): this harness renders a static, non-stateful
        // `searchValue` prop, so React's controlled-input DOM-value restoration resets the input back to ''
        // after every keystroke (onSearchChange never feeds a new value back in). user.type would therefore
        // report each keystroke's single delta character ('l', 'a', 'm', 'b') instead of the full string —
        // a React controlled-input artifact of this unit harness, not a bug. fireEvent.change's single
        // full-value change event is the correct simulation for this contract.
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'lamb' } });

        expect(onSearchChange).toHaveBeenCalledWith('lamb');
    });

    it('draws the FAB glyph as a geometrically centred icon, not a baseline-positioned character', () => {
        // The FAB rendered the literal text "+". Flex centring centres the LINE BOX, but the ink inside it is
        // placed by the BASELINE — "+" sits on the math axis (~0.29em above baseline) while the em-box centre
        // is ~0.365em above it, so the glyph paints ~1.7px low at 24px. That offset is INVARIANT under
        // line-height, so no amount of added centring properties fixes it; only a symmetric shape does.
        // docs/mockups/screens/screen-recipes.html draws this FAB with an SVG whose extents (4→20 on both
        // axes) are exactly symmetric about the viewBox centre.
        renderList({ status: 'loading' });

        const fab = screen.getByRole('button', { name: 'New recipe' });

        expect(fab.querySelector('svg')).not.toBeNull();
        expect(fab.textContent).toBe('');
    });

    it('reports create requests upward from the dial’s ONE destination', async () => {
        // REWRITTEN for U34 (owner ruling 2026-08-25). This previously asserted that pressing the FAB called
        // `onCreateRecipe` directly. The FAB is now a menu TRIGGER, so the create request comes from the
        // dial's single destination instead — the accepted +1 tap. The old assertion would have passed
        // against a dial that opened and wired its item to nothing.
        const user = userEvent.setup();
        const onCreateRecipe = vi.fn();
        renderList({ status: 'ready', recipes: threeRecipes, onCreateRecipe });

        await user.click(screen.getByRole('button', { name: 'New recipe' }));

        expect(onCreateRecipe).not.toHaveBeenCalled();

        await user.click(screen.getByRole('menuitem', { name: 'Create from Scratch' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
    });

    it('offers NO paste destination when the host supplies none — absence removes it, not disables it', async () => {
        // ⛔ A host with no paste route (none existed before plan U9, and the contract must survive one)
        // must not render a menu entry that goes nowhere. Rendering it disabled would be worse: a control
        // that looks reachable and is not.
        const user = userEvent.setup();
        renderList({ status: 'ready', recipes: threeRecipes });

        await user.click(screen.getByRole('button', { name: 'New recipe' }));

        expect(screen.getByRole('menuitem', { name: 'Create from Scratch' })).toBeTruthy();
        expect(screen.queryByRole('menuitem', { name: 'Paste an Ingredient List' })).toBeNull();
    });

    it('opens the paste surface from the dial’s SECOND destination (plan U9)', async () => {
        const user = userEvent.setup();
        const onPasteIngredients = vi.fn();
        renderList({ status: 'ready', recipes: threeRecipes, onPasteIngredients });

        await user.click(screen.getByRole('button', { name: 'New recipe' }));
        await user.click(screen.getByRole('menuitem', { name: 'Paste an Ingredient List' }));

        expect(onPasteIngredients).toHaveBeenCalledTimes(1);
    });

    it('keeps "Create from Scratch" FIRST — the primary path must not move when a destination is added', async () => {
        const user = userEvent.setup();
        renderList({ status: 'ready', recipes: threeRecipes, onPasteIngredients: vi.fn() });

        await user.click(screen.getByRole('button', { name: 'New recipe' }));

        const labels = screen.getAllByRole('menuitem').map((item) => item.textContent);
        expect(labels).toEqual(['Create from Scratch', 'Paste an Ingredient List']);
    });

    it('lands on the create surface when the dial’s destination is chosen', async () => {
        // Driven STATEFULLY rather than with a bare `vi.fn()`: a spy proves a handler ran, not that anything
        // downstream happened. Here choosing the destination actually swaps the surface, which is the thing
        // the Playwright and Maestro flows assert end to end.
        const user = userEvent.setup();

        function Harness() {
            const [creating, setCreating] = useState(false);

            return creating ? (
                <h1>{'CREATE SURFACE'}</h1>
            ) : (
                <RecipeList
                    status="ready"
                    recipes={threeRecipes}
                    searchValue=""
                    onSearchChange={noop}
                    onSelectRecipe={noop}
                    onCreateRecipe={() => setCreating(true)}
                    onRetry={noop}
                />
            );
        }

        render(<Harness />);

        await user.click(screen.getByRole('button', { name: 'New recipe' }));
        await user.click(screen.getByRole('menuitem', { name: 'Create from Scratch' }));

        expect(screen.getByRole('heading', { name: 'CREATE SURFACE' })).toBeTruthy();
        expect(screen.queryByRole('menu')).toBeNull();
    });
});

describe('RecipeList (web) — U8 brand title band', () => {
    it('sits the heading in a brand gradient title band', () => {
        const { container } = render(
            <RecipeList
                status="loading"
                recipes={[]}
                searchValue=""
                onSearchChange={noop}
                onSelectRecipe={noop}
                onCreateRecipe={noop}
                onRetry={noop}
            />,
        );

        // GradientSurface (web) paints an inline linear-gradient background behind the header; the heading
        // lives inside that band.
        const band = Array.from(container.querySelectorAll<HTMLElement>('*')).find((el) =>
            el.style.backgroundImage.startsWith('linear-gradient'),
        );

        expect(band).toBeDefined();
        expect(band?.querySelector('h1')).not.toBeNull();
    });

    it('threads the Playfair display family onto the list heading', () => {
        renderList({ status: 'loading' });

        expect(screen.getByRole('heading', { name: 'Recipes' }).className).toContain('font-display');
    });
});

describe('RecipeList (web) — create FAB (L1)', () => {
    it('renders the create control as a pinned FAB OUTSIDE the header', () => {
        // REWRITTEN for U34: the pinned-position class moved from the button onto the dial's anchor, so that
        // the disclosed menu is positioned against the SAME derived offset instead of a second copy of it.
        // The offset expression itself is asserted by `SpeedDial.test.tsx`; what belongs HERE is that the
        // list still mounts a pinned control that is not header chrome.
        renderList({ status: 'ready', recipes: threeRecipes });

        const fab = screen.getByRole('button', { name: 'New recipe' });
        // Position isn't queryable in jsdom; assert the pinned-FAB class contract + that it is not chrome.
        expect(fab.parentElement?.className).toContain('fixed');
        expect(fab.closest('header')).toBeNull();
    });

    it('keeps the FAB present across loading, error, and populated states', () => {
        for (const state of ['loading', 'error', 'ready'] as const) {
            cleanup();
            renderList({ status: state, recipes: state === 'ready' ? threeRecipes : [] });
            expect(screen.getByRole('button', { name: 'New recipe' })).toBeTruthy();
        }
    });

    it('suppresses the FAB in the empty state, where the empty-state CTA is the sole create control', () => {
        renderList({ status: 'ready', recipes: [] });

        // Exactly ONE create affordance on empty — the empty CTA, not a second floating FAB.
        const createButtons = screen.getAllByRole('button', { name: /Create your first recipe|New recipe/ });
        expect(createButtons).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Create your first recipe' })).toBeTruthy();
        expect(screen.queryByRole('menu')).toBeNull();
        expect(screen.queryByRole('menuitem')).toBeNull();
    });

    it('wires the empty-state CTA to the create handler', async () => {
        const user = userEvent.setup();
        const onCreateRecipe = vi.fn();
        renderList({ status: 'ready', recipes: [], onCreateRecipe });

        await user.click(screen.getByRole('button', { name: 'Create your first recipe' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
    });
});

// The switcher's own contract — link semantics, the resting affordance, its contrast floors and touch
// targets — is owned by `RecipeSourceTabs.test.tsx` (ONE strip, shared with the discovery surface). What
// belongs HERE is the composition: that this view mounts it, and that the active source still drives the
// list's own Community-specific behaviour.
describe('RecipeList (web) — source tabs (L5)', () => {
    it('renders no source switcher when no tab prop is given (backward compatible)', () => {
        renderList({ status: 'ready', recipes: threeRecipes });

        expect(screen.queryByRole('navigation', { name: 'Recipe source' })).toBeNull();
    });

    it('mounts the shared switcher with the active source marked and BOTH destinations reachable', () => {
        renderList({
            status: 'ready',
            recipes: threeRecipes,
            tab: { active: 'mine', href: HREF },
        });

        const nav = screen.getByRole('navigation', { name: 'Recipe source' });
        expect(within(nav).getByRole('link', { name: 'My Recipes' }).getAttribute('aria-current')).toBe('page');
        expect(within(nav).getByRole('link', { name: 'Community' }).getAttribute('href')).toBe('/en/discover');
    });

    it('shows the distinct Community empty copy and NO FAB on the Community tab', () => {
        renderList({
            status: 'ready',
            recipes: [],
            tab: { active: 'community', href: HREF },
        });

        expect(screen.getByText('No community recipes')).toBeTruthy();
        expect(screen.queryByText('No recipes yet')).toBeNull();
        // FAB is My-Recipes-only — you never create into the community list. Both the dial's TRIGGER and
        // its menu are asserted absent: a dial that rendered its panel while hiding the button would still
        // be a create affordance on someone else's library.
        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
        expect(screen.queryByRole('menu')).toBeNull();
        expect(screen.queryByRole('menuitem')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Create your first recipe' })).toBeNull();
    });
});

describe('RecipeList (web) — quick-filter chips (L4)', () => {
    it('renders no chip row when no filters prop is given (backward compatible)', () => {
        renderList({ status: 'ready', recipes: threeRecipes });

        expect(screen.queryByRole('group', { name: 'Quick filters' })).toBeNull();
    });

    it('renders one chip per available facet, marking active ones pressed', () => {
        renderList({
            status: 'ready',
            recipes: threeRecipes,
            filters: { available: ['Vegetarian', 'Italian'], active: ['Italian'], onToggle: noop, onClear: noop },
        });

        const chips = screen.getByRole('group', { name: 'Quick filters' });
        expect(within(chips).getByRole('button', { name: 'Vegetarian' }).getAttribute('aria-pressed')).toBe('false');
        expect(within(chips).getByRole('button', { name: 'Italian' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('renders a leading "All" chip, pressed only when no facet is active, that clears the filters', async () => {
        const user = userEvent.setup();
        const onClear = vi.fn();
        renderList({
            status: 'ready',
            recipes: threeRecipes,
            filters: { available: ['Vegetarian'], active: ['Vegetarian'], onToggle: noop, onClear },
        });

        const chips = screen.getByRole('group', { name: 'Quick filters' });
        // A facet is active, so "All" is NOT pressed.
        expect(within(chips).getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('false');

        await user.click(within(chips).getByRole('button', { name: 'All' }));
        expect(onClear).toHaveBeenCalledTimes(1);
    });

    it('marks "All" pressed when no facet is active', () => {
        renderList({
            status: 'ready',
            recipes: threeRecipes,
            filters: { available: ['Vegetarian'], active: [], onToggle: noop, onClear: noop },
        });

        const chips = screen.getByRole('group', { name: 'Quick filters' });
        expect(within(chips).getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('reports a chip toggle upward with the facet value', async () => {
        const user = userEvent.setup();
        const onToggle = vi.fn();
        renderList({
            status: 'ready',
            recipes: threeRecipes,
            filters: { available: ['Vegetarian'], active: [], onToggle, onClear: noop },
        });

        const chips = screen.getByRole('group', { name: 'Quick filters' });
        await user.click(within(chips).getByRole('button', { name: 'Vegetarian' }));

        expect(onToggle).toHaveBeenCalledWith('Vegetarian');
    });

    it('gives the quick-filter chips a taller base tap target, reset to the desktop density at md (U5)', () => {
        renderList({
            status: 'ready',
            recipes: threeRecipes,
            filters: { available: ['Vegetarian'], active: [], onToggle: noop, onClear: noop },
        });

        const chips = screen.getByRole('group', { name: 'Quick filters' });

        // Base `py-1.5` grows the mobile tap target; `md:py-1` restores the original desktop chip density,
        // so the 1280px surface is byte-identical.
        for (const name of ['All', 'Vegetarian'] as const) {
            const chip = within(chips).getByRole('button', { name });
            expect(chip.className).toContain('py-1.5');
            expect(chip.className).toContain('md:py-1');
        }
    });

    it('renders the QUICK_TIME_FACET sentinel as the localized "Quick (<30m)" label, not the raw token', async () => {
        const user = userEvent.setup();
        const onToggle = vi.fn();
        renderList({
            status: 'ready',
            recipes: threeRecipes,
            filters: { available: ['quick', 'Italian'], active: [], onToggle, onClear: noop },
        });

        const chips = screen.getByRole('group', { name: 'Quick filters' });
        expect(within(chips).queryByRole('button', { name: 'quick' })).toBeNull();

        await user.click(within(chips).getByRole('button', { name: 'Quick (<30m)' }));

        // Toggling still reports the underlying sentinel token upward, not the display label.
        expect(onToggle).toHaveBeenCalledWith('quick');
    });
});

describe('RecipeList (web) — loading state', () => {
    it('shows a busy status and no recipe rows', () => {
        renderList({ status: 'loading' });

        expect(screen.getByRole('status')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Grilled Lamb/ })).toBeNull();
    });

    it('announces the localized loading label as the live region CONTENT, not only its aria-label', () => {
        renderList({ status: 'loading' });

        // The shimmer placeholders are all `aria-hidden`, so without a visible caption the live region has NO
        // content — and a live region announces its CONTENT, not its label. Screen readers hear nothing.
        expect(screen.getByRole('status').textContent).toContain('Loading recipes');
    });

    it('renders real shimmer skeleton rows (not blank spans) inside the busy region (U5)', () => {
        renderList({ status: 'loading' });

        // The old loading body was three empty `<span>`s — visually nothing. U5 replaces them with real,
        // card-shaped shimmer placeholders so the wait reads as loading content, not a broken page. They are
        // decorative (aria-hidden) and animate with `animate-pulse`.
        const status = screen.getByRole('status');
        const shimmer = status.querySelectorAll('.animate-pulse');
        expect(shimmer.length).toBeGreaterThanOrEqual(3);

        // Every placeholder is hidden from assistive tech — the `role="status"` label already announces it.
        for (const node of Array.from(shimmer)) {
            expect(node.closest('[aria-hidden="true"]')).not.toBeNull();
        }
    });
});

describe('RecipeList (web) — error state', () => {
    it('shows an alert with a retry action that reports upward', async () => {
        const user = userEvent.setup();
        const onRetry = vi.fn();
        renderList({ status: 'error', onRetry });

        expect(screen.getByRole('alert')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('does not render recipe rows in the error state', () => {
        renderList({ status: 'error', recipes: threeRecipes });

        expect(screen.queryByRole('button', { name: /Grilled Lamb/ })).toBeNull();
    });
});

describe('RecipeList (web) — empty state', () => {
    it('shows the empty message when a successful load returns no recipes', () => {
        renderList({ status: 'ready', recipes: [] });

        expect(screen.getByText('No recipes yet')).toBeTruthy();
    });

    it('renders neither a count nor rows when empty', () => {
        renderList({ status: 'ready', recipes: [] });

        expect(screen.queryByText('0 recipes')).toBeNull();
        expect(screen.queryByRole('list')).toBeNull();
    });
});

describe('RecipeList (web) — no-match state', () => {
    it('shows the no-match copy (NOT the empty copy) when a search filters every row out', () => {
        // The caller HAS recipes; an active term filtered them all out. Showing "No recipes yet" here would
        // be the empty-vs-no-match copy bug — assert the distinct no-match copy and the absence of the empty.
        renderList({ status: 'ready', recipes: [], searchValue: 'zzz' });

        expect(screen.getByText('No matching recipes')).toBeTruthy();
        expect(screen.queryByText('No recipes yet')).toBeNull();
    });

    it('shows the empty copy when there is no active search', () => {
        renderList({ status: 'ready', recipes: [], searchValue: '   ' });

        expect(screen.getByText('No recipes yet')).toBeTruthy();
        expect(screen.queryByText('No matching recipes')).toBeNull();
    });

    it('treats an active FACET chip that filtered every row out as a no-match, not a first-run empty', () => {
        // The facet chips are DERIVED from the loaded library, so a chip can only exist when the caller HAS
        // recipes. Zero rows with a chip pressed is therefore a NO-MATCH — deriving the empty-vs-no-match
        // split from `searchValue` alone tells a viewer with a full library that they have no recipes at all.
        // Same defect class the discovery surface already fixed (`searchValue || hasActiveFilters`).
        renderList({
            status: 'ready',
            recipes: [],
            searchValue: '',
            filters: { available: ['Vegetarian', 'Italian'], active: ['Vegetarian'], onToggle: noop, onClear: noop },
        });

        expect(screen.getByText('No matching recipes')).toBeTruthy();
        expect(screen.queryByText('No recipes yet')).toBeNull();
    });

    it('offers no first-run create CTA, and keeps the FAB, when a facet filtered every row out', () => {
        renderList({
            status: 'ready',
            recipes: [],
            searchValue: '',
            filters: { available: ['Vegetarian'], active: ['Vegetarian'], onToggle: noop, onClear: noop },
        });

        // "Create your first recipe" is first-run copy; the caller is not on their first run.
        expect(screen.queryByRole('button', { name: 'Create your first recipe' })).toBeNull();
        // The FAB is the persistent create control everywhere EXCEPT the true empty state.
        expect(screen.getByRole('button', { name: 'New recipe' })).toBeTruthy();
    });

    it('still shows the first-run empty copy when chips are OFFERED but none is active', () => {
        // The other direction: available chips are not themselves a narrowing. Only an ACTIVE facet is.
        renderList({
            status: 'ready',
            recipes: [],
            searchValue: '',
            filters: { available: ['Vegetarian'], active: [], onToggle: noop, onClear: noop },
        });

        expect(screen.getByText('No recipes yet')).toBeTruthy();
        expect(screen.queryByText('No matching recipes')).toBeNull();
        expect(screen.getByRole('button', { name: 'Create your first recipe' })).toBeTruthy();
    });
});

describe('RecipeList (web) — populated state', () => {
    it('renders a pluralized result count', () => {
        renderList({ status: 'ready', recipes: threeRecipes });

        expect(screen.getByText('3 recipes')).toBeTruthy();
    });

    it('renders one card per recipe', () => {
        renderList({ status: 'ready', recipes: threeRecipes });

        expect(screen.getByRole('button', { name: 'Mediterranean Grilled Lamb' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Asparagus with Green Sauce' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Gourmet Garden Salad' })).toBeTruthy();
    });

    it('reports the selected recipe id upward', async () => {
        const user = userEvent.setup();
        const onSelectRecipe = vi.fn();
        renderList({ status: 'ready', recipes: threeRecipes, onSelectRecipe });

        await user.click(screen.getByRole('button', { name: 'Asparagus with Green Sauce' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_2');
    });

    it('renders the rows in a list structure', () => {
        renderList({ status: 'ready', recipes: threeRecipes });

        const list = screen.getByRole('list');
        expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    });
});

describe('RecipeList (web) — touch targets (44px floor)', () => {
    // The source tabs' own floor moved WITH them, to `RecipeSourceTabs.test.tsx`.
    it('gives the "All" chip and every facet chip the 44px touch floor, reset for the mouse at md', () => {
        renderList({
            status: 'ready',
            recipes: threeRecipes,
            filters: { available: ['Vegetarian', 'Italian'], active: ['Italian'], onToggle: noop, onClear: noop },
        });

        const chips = screen.getByRole('group', { name: 'Quick filters' });

        for (const name of ['All', 'Vegetarian', 'Italian']) {
            const chip = within(chips).getByRole('button', { name });
            expect(chip.className).toContain('min-h-11');
            expect(chip.className).toContain('md:min-h-0');
        }
    });
});

describe('RecipeList (web) — text contrast (WCAG 2.1 AA)', () => {
    // The source tabs' contrast — selected AND unselected, resting AND hover, label AND boundary — moved with
    // them to `RecipeSourceTabs.test.tsx`, where the strip is measured once for both surfaces that mount it.
    it('keeps the search field’s PLACEHOLDER text legible on the field', () => {
        renderList({ status: 'ready', recipes: threeRecipes });

        // Placeholder copy is TEXT a reader reads — the field's only visible instruction before they type — so
        // it owes the same 4.5:1 as body copy; `mist` measured 1.90:1 here. `placeholder:` is just another
        // Tailwind variant, so it is measured as its own state (the base `text-charcoal` on the same element is
        // the VALUE colour and would mask the defect). See `@commise/ui`'s `tokens/colors.ts` JSDoc.
        const search = screen.getByRole('searchbox', { name: 'Search recipes' });

        expect(
            utilityContrast(search.className, { surface: semantic.card, variant: 'placeholder' }),
            'recipe-list search placeholder on the card-white field',
        ).toBeGreaterThanOrEqual(4.5);
    });
});

/**
 * The list is a `<section>` on the app background, so that is the surface its search field's focus ring is
 * drawn on — a Tailwind `ring-*` is a spread box-shadow OUTSIDE the border box, so the field's own `bg-card`
 * fill is NOT what a reader sees the ring against.
 *
 * The ring shipped as `ring-seafoam-light` (2.58:1 there), under the 3:1 SC 1.4.11 floor a focus indicator
 * owes (#114). The search box is the surface's primary control and `outline-none` removes the browser's own
 * indicator, so the ring is the ONLY thing telling a keyboard viewer where they are.
 */
describe('RecipeList (web) — the search field’s focus ring clears the 3:1 SC 1.4.11 floor', () => {
    it('rings the search box legibly against the page it sits on', () => {
        renderList();

        const search = screen.getByRole('searchbox', { name: 'Search recipes' });

        expect(search.className, 'the browser outline is suppressed, so the ring is the whole indicator') //
            .toContain('outline-none');
        expect(
            ringContrast(search.className, { surface: semantic.background }),
            'recipe-search focus ring',
        ).toBeGreaterThanOrEqual(3);
    });

    it('out-measures the `seafoam-light` it replaced', () => {
        renderList();

        expect(
            ringContrast(screen.getByRole('searchbox', { name: 'Search recipes' }).className, {
                surface: semantic.background,
            }),
        ).toBeGreaterThan(ringContrast('ring-2 ring-seafoam-light', { surface: semantic.background }));
    });
});
