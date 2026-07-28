/**
 * Native component tests for the recipe-list view (rendered via react-native-web under jsdom). Mirrors the
 * web leaf across EVERY state — loading, error, empty, populated — plus the persistent chrome and the
 * interaction contracts, so the two platform renders cannot drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { nativeTokens } from '@commise/ui/native';

import { makeRecipeListItem } from '../../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeList } from '../RecipeList.native.js';
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

const threeRecipes = [
    makeRecipeListItem({ id: 'rec_1', title: 'Mediterranean Grilled Lamb', totalTimeMinutes: 45 }),
    makeRecipeListItem({ id: 'rec_2', title: 'Asparagus with Green Sauce', totalTimeMinutes: 20 }),
    makeRecipeListItem({ id: 'rec_3', title: 'Gourmet Garden Salad', totalTimeMinutes: 15 }),
];

describe('RecipeList (native) — chrome', () => {
    it('always renders the heading, search field, and create action', () => {
        renderList({ status: 'loading' });

        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
        expect(screen.getByLabelText('Search recipes')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'New recipe' })).toBeTruthy();
    });

    it('reports search input changes upward', () => {
        const onSearchChange = vi.fn();
        renderList({ onSearchChange });

        fireEvent.change(screen.getByLabelText('Search recipes'), { target: { value: 'lamb' } });

        expect(onSearchChange).toHaveBeenCalledWith('lamb');
    });

    it('reports create requests upward from the FAB', () => {
        const onCreateRecipe = vi.fn();
        renderList({ status: 'ready', recipes: threeRecipes, onCreateRecipe });

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeList (native) — U8 brand title band', () => {
    // The heading must resolve to a REGISTERED Playfair face: React Native renders a CSS font stack as the
    // system font, silently and without error. `getComputedStyle` does not resolve react-native-web's
    // class-compiled family, so this reads the injected declaration and rejects any comma-bearing stack.
    it('paints the heading in the registered bold Playfair face, never a CSS font stack', () => {
        renderList({ status: 'loading' });

        const applied = appliedFontFamily(screen.getByRole('heading', { name: 'Recipes' }));

        expect(applied).toBe(nativeTokens.fontFace.display.bold);
        expect(applied).not.toContain(',');
    });

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

        const band = container.querySelector('[data-commise-stub="linear-gradient"]');
        expect(band).not.toBeNull();
        // The heading rides inside the gradient band.
        expect(band?.querySelector('[role="heading"]')).not.toBeNull();
    });
});

describe('RecipeList (native) — create FAB (L1)', () => {
    it('renders the create control as a FAB OUTSIDE the header row', () => {
        renderList({ status: 'ready', recipes: threeRecipes });

        const header = screen.getByRole('heading', { name: 'Recipes' }).parentElement as HTMLElement;
        expect(within(header).queryByRole('button', { name: 'New recipe' })).toBeNull();
        expect(screen.getByRole('button', { name: 'New recipe' })).toBeTruthy();
    });

    it('keeps the FAB present across loading, error, and populated states', () => {
        for (const state of ['loading', 'error', 'ready'] as const) {
            cleanup();
            renderList({ status: state, recipes: state === 'ready' ? threeRecipes : [] });
            expect(screen.getByRole('button', { name: 'New recipe' })).toBeTruthy();
        }
    });

    it('suppresses the FAB in the empty state, where the empty CTA is the sole create control', () => {
        renderList({ status: 'ready', recipes: [] });

        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Create your first recipe' })).toBeTruthy();
    });

    it('wires the empty-state CTA to the create handler', () => {
        const onCreateRecipe = vi.fn();
        renderList({ status: 'ready', recipes: [], onCreateRecipe });

        fireEvent.click(screen.getByRole('button', { name: 'Create your first recipe' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeList (native) — source tabs (L5)', () => {
    it('renders no tab control when no tab prop is given', () => {
        renderList({ status: 'ready', recipes: threeRecipes });

        expect(screen.queryByText('Community')).toBeNull();
    });

    it('renders My Recipes / Community tabs and reports a change upward', () => {
        const onChange = vi.fn();
        renderList({ status: 'ready', recipes: threeRecipes, tab: { active: 'mine', onChange } });

        expect(screen.getByText('My Recipes')).toBeTruthy();
        fireEvent.click(screen.getByText('Community'));

        expect(onChange).toHaveBeenCalledWith('community');
    });

    it('shows the Community empty copy and NO FAB on the Community tab', () => {
        renderList({ status: 'ready', recipes: [], tab: { active: 'community', onChange: noop } });

        expect(screen.getByText('No community recipes')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Create your first recipe' })).toBeNull();
    });
});

describe('RecipeList (native) — quick-filter chips (L4)', () => {
    it('renders no chip row when no filters prop is given', () => {
        renderList({ status: 'ready', recipes: threeRecipes });

        expect(screen.queryByLabelText('Quick filters')).toBeNull();
    });

    it('renders a chip per available facet and reports a toggle upward', () => {
        const onToggle = vi.fn();
        renderList({
            status: 'ready',
            recipes: threeRecipes,
            filters: { available: ['Vegetarian', 'Italian'], active: ['Italian'], onToggle, onClear: noop },
        });

        expect(screen.getByLabelText('Quick filters')).toBeTruthy();
        fireEvent.click(screen.getByText('Vegetarian'));

        expect(onToggle).toHaveBeenCalledWith('Vegetarian');
    });

    it('renders a leading "All" chip that clears the filters', () => {
        const onClear = vi.fn();
        renderList({
            status: 'ready',
            recipes: threeRecipes,
            filters: { available: ['Vegetarian'], active: ['Vegetarian'], onToggle: noop, onClear },
        });

        fireEvent.click(screen.getByText('All'));

        expect(onClear).toHaveBeenCalledTimes(1);
    });

    it('renders the QUICK_TIME_FACET sentinel as the localized "Quick (<30m)" label, not the raw token', () => {
        const onToggle = vi.fn();
        renderList({
            status: 'ready',
            recipes: threeRecipes,
            filters: { available: ['quick', 'Italian'], active: [], onToggle, onClear: noop },
        });

        expect(screen.queryByText('quick')).toBeNull();
        fireEvent.click(screen.getByText('Quick (<30m)'));

        // Toggling still reports the underlying sentinel token upward, not the display label.
        expect(onToggle).toHaveBeenCalledWith('quick');
    });
});

describe('RecipeList (native) — pull-to-refresh (L8)', () => {
    it('still renders the populated rows when a refresh control is wired (RefreshControl is a no-op in jsdom)', () => {
        // The pull gesture + spinner are a device/Maestro concern (react-native-web renders RefreshControl
        // inertly). This guards that wiring the control does not break the list body.
        renderList({
            status: 'ready',
            recipes: threeRecipes,
            refresh: { refreshing: true, onRefresh: noop },
        });

        expect(screen.getByRole('button', { name: 'Mediterranean Grilled Lamb' })).toBeTruthy();
        expect(screen.getByText('3 recipes')).toBeTruthy();
    });
});

describe('RecipeList (native) — loading state', () => {
    it('shows the loading label and no recipe rows', () => {
        renderList({ status: 'loading' });

        expect(screen.getByLabelText('Loading recipes')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Grilled Lamb/ })).toBeNull();
    });

    it('renders inert skeleton cards (not a blank view) while loading (U4)', () => {
        renderList({ status: 'loading' });

        // The loading region stays labelled for assistive tech but now carries motion-free skeleton cards,
        // hidden from it — mirrors the discovery skeletons.
        const region = screen.getByLabelText('Loading recipes');
        expect(region.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
    });
});

describe('RecipeList (native) — touch targets (U4 / RC-3)', () => {
    it('gives the source tabs a 44pt minimum hit area', () => {
        renderList({ status: 'ready', recipes: threeRecipes, tab: { active: 'mine', onChange: noop } });

        for (const tab of screen.getAllByRole('tab')) {
            expect(window.getComputedStyle(tab).minHeight).toBe('44px');
        }
    });
});

describe('RecipeList (native) — error state', () => {
    it('shows an alert with a retry action that reports upward', () => {
        const onRetry = vi.fn();
        renderList({ status: 'error', onRetry });

        expect(screen.getByRole('alert')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeList (native) — empty state', () => {
    it('shows the empty message when a successful load returns no recipes', () => {
        renderList({ status: 'ready', recipes: [] });

        expect(screen.getByText('No recipes yet')).toBeTruthy();
    });
});

describe('RecipeList (native) — no-match state', () => {
    it('shows the no-match copy (NOT the empty copy) when a search filters every row out', () => {
        renderList({ status: 'ready', recipes: [], searchValue: 'zzz' });

        expect(screen.getByText('No matching recipes')).toBeTruthy();
        expect(screen.queryByText('No recipes yet')).toBeNull();
    });

    it('treats an active FACET chip that filtered every row out as a no-match, not a first-run empty', () => {
        // Parity with the web leaf: the chips are derived from the loaded library, so a pressed chip means the
        // caller HAS recipes. Zero rows under a pressed chip is a no-match, never "No recipes yet".
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

        expect(screen.queryByRole('button', { name: 'Create your first recipe' })).toBeNull();
        expect(screen.getByRole('button', { name: 'New recipe' })).toBeTruthy();
    });

    it('still shows the first-run empty copy when chips are OFFERED but none is active', () => {
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

describe('RecipeList (native) — populated state', () => {
    it('renders a pluralized result count', () => {
        renderList({ status: 'ready', recipes: threeRecipes });

        expect(screen.getByText('3 recipes')).toBeTruthy();
    });

    it('renders one button per recipe and reports selection upward', () => {
        const onSelectRecipe = vi.fn();
        renderList({ status: 'ready', recipes: threeRecipes, onSelectRecipe });

        expect(screen.getByRole('button', { name: 'Mediterranean Grilled Lamb' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Asparagus with Green Sauce' }));
        expect(onSelectRecipe).toHaveBeenCalledWith('rec_2');
    });
});

/**
 * Read back the `font-family` react-native-web ACTUALLY applied to `element`.
 *
 * RNW compiles a `StyleSheet` `fontFamily` into an atomic `r-fontFamily-*` class whose rule it injects into
 * the document; jsdom's `getComputedStyle` does not resolve that rule (it reports the RNW default text
 * stack), so the honest read is the injected declaration itself. Returns `undefined` when the element
 * carries no compiled family — which is itself a failure for a leaf that is supposed to set one.
 */
function appliedFontFamily(element: Element): string | undefined {
    const className = element.className.split(' ').find((name) => name.startsWith('r-fontFamily-'));

    if (className === undefined) {
        return undefined;
    }

    const sheets = document.styleSheets;

    for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
        const rules = sheets[sheetIndex]?.cssRules;

        for (let ruleIndex = 0; ruleIndex < (rules?.length ?? 0); ruleIndex += 1) {
            const rule = rules?.[ruleIndex];

            if (rule instanceof CSSStyleRule && rule.selectorText === `.${className}`) {
                return rule.style.getPropertyValue('font-family');
            }
        }
    }

    return undefined;
}
