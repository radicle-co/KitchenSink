/**
 * Native component tests for the recipe-list view (rendered via react-native-web under jsdom). Mirrors the
 * web leaf across EVERY state — loading, error, empty, populated — plus the persistent chrome and the
 * interaction contracts, so the two platform renders cannot drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { placeholderContrast } from '@commise/test-utils';
import { nativeTokens } from '@commise/ui/native';
import { palette } from '@commise/ui';

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

/** The source switcher's destinations. Native ignores them (its shell has no URLs) — see the control's JSDoc. */
const HREF = { mine: '/en/recipes', community: '/en/discover' } as const;

const threeRecipes = [
    makeRecipeListItem({ id: 'rec_1', title: 'Mediterranean Grilled Lamb', totalTimeMinutes: 45 }),
    makeRecipeListItem({ id: 'rec_2', title: 'Asparagus with Green Sauce', totalTimeMinutes: 20 }),
    makeRecipeListItem({ id: 'rec_3', title: 'Gourmet Garden Salad', totalTimeMinutes: 15 }),
];

describe('RecipeList (native) — chrome', () => {
    it('draws the FAB glyph as an icon, never a baseline-positioned "+" character', () => {
        // Native mirrored web's defect AND compounded it: `fabLabel` hard-coded `lineHeight: 32` under a
        // `displayMd` (28) font — off-token leading that iOS applies as extra leading and Android pairs with
        // `includeFontPadding`. The icon stub renders null here, so the falsifiable assertion is the ABSENCE
        // of the text glyph: a "+" character in the FAB is exactly the defect.
        //
        // Rendered from a SETTLED, populated list rather than `loading`: the dial no longer mounts while the
        // library is still resolving, and this assertion is about the glyph, not about when the dial appears.
        renderList({ status: 'ready', recipes: threeRecipes });

        const fab = screen.getByRole('button', { name: 'New recipe' });

        expect(within(fab).queryByText('+')).toBeNull();
    });

    it('renders the heading and search field while the list is still loading', () => {
        // NARROWED, mirroring the web leaf. This used to also assert the create dial from the LOADING
        // state, which is the very claim the mid-interaction-unmount defect made false — the dial now
        // waits for the library to resolve. Its state matrix belongs to the "create FAB (L1)" block.
        renderList({ status: 'loading' });

        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
        expect(screen.getByLabelText('Search recipes')).toBeTruthy();
    });

    it('reports search input changes upward', () => {
        const onSearchChange = vi.fn();
        renderList({ onSearchChange });

        fireEvent.change(screen.getByLabelText('Search recipes'), { target: { value: 'lamb' } });

        expect(onSearchChange).toHaveBeenCalledWith('lamb');
    });

    it('reports create requests upward from the dial’s ONE destination', () => {
        // REWRITTEN for U34 (owner ruling 2026-08-25). This previously asserted that pressing the FAB called
        // `onCreateRecipe` directly. The FAB is now a menu TRIGGER, so the create request comes from the
        // dial's single destination instead — the accepted +1 tap. The old assertion would have passed
        // against a dial that opened and wired its item to nothing.
        const onCreateRecipe = vi.fn();
        renderList({ status: 'ready', recipes: threeRecipes, onCreateRecipe });

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));

        expect(onCreateRecipe).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('menuitem', { name: 'Create from Scratch' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
    });

    it('offers NO paste destination when the host supplies none — absence removes it, not disables it', () => {
        // ⛔ A host with no paste route (none existed before plan U9, and the contract must survive one)
        // must not render a menu entry that goes nowhere. Rendering it disabled would be worse: a control
        // that looks reachable and is not.
        renderList({ status: 'ready', recipes: threeRecipes });

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));

        expect(screen.getByRole('menuitem', { name: 'Create from Scratch' })).toBeTruthy();
        expect(screen.queryByRole('menuitem', { name: 'Paste an Ingredient List' })).toBeNull();
    });

    it('opens the paste surface from the dial’s SECOND destination (plan U9)', () => {
        const onPasteIngredients = vi.fn();
        renderList({ status: 'ready', recipes: threeRecipes, onPasteIngredients });

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Paste an Ingredient List' }));

        expect(onPasteIngredients).toHaveBeenCalledTimes(1);
    });

    it('keeps "Create from Scratch" FIRST — the primary path must not move when a destination is added', () => {
        renderList({ status: 'ready', recipes: threeRecipes, onPasteIngredients: vi.fn() });

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));

        const labels = screen.getAllByRole('menuitem').map((item) => item.textContent);
        expect(labels).toEqual(['Create from Scratch', 'Paste an Ingredient List']);
    });

    it('lands on the create surface when the dial’s destination is chosen', () => {
        // Driven STATEFULLY rather than with a bare `vi.fn()`: a spy proves a handler ran, not that anything
        // downstream happened. Here choosing the destination actually swaps the surface, which is what the
        // Maestro flow asserts on a device.
        function Harness() {
            const [creating, setCreating] = useState(false);

            return creating ? (
                <Text>{'CREATE SURFACE'}</Text>
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

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Create from Scratch' }));

        expect(screen.getByText('CREATE SURFACE')).toBeTruthy();
        expect(screen.queryByRole('menu')).toBeNull();
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

    it('keeps the FAB present across error and populated states', () => {
        // NARROWED from "loading, error, and populated", mirroring the web leaf: `loading` moved out and got
        // its own assertion below, because keeping the dial there is what let it unmount mid-interaction.
        for (const state of ['error', 'ready'] as const) {
            cleanup();
            renderList({ status: state, recipes: state === 'ready' ? threeRecipes : [] });
            expect(screen.getByRole('button', { name: 'New recipe' })).toBeTruthy();
        }
    });

    it('withholds the FAB while the library is still LOADING, and offers no create control at all there', () => {
        renderList({ status: 'loading' });

        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
        expect(screen.queryByRole('menu')).toBeNull();
        expect(screen.queryByRole('menuitem')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Create your first recipe' })).toBeNull();
    });

    it('does not mount the dial before a first-run library settles EMPTY, so nothing unmounts mid-press', () => {
        // ⛔ THE DEFECT ITSELF, driven as the TRANSITION rather than as two independent snapshots — the
        // mobile mirror of the web leaf's assertion, so a fix to one platform cannot miss the other.
        function Harness() {
            const [status, setStatus] = useState<'loading' | 'ready'>('loading');

            return (
                <>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="SETTLE"
                        onPress={() => setStatus('ready')}
                    >
                        <Text>{'SETTLE'}</Text>
                    </Pressable>
                    <RecipeList
                        status={status}
                        recipes={[]}
                        searchValue=""
                        onSearchChange={noop}
                        onSelectRecipe={noop}
                        onCreateRecipe={noop}
                        onRetry={noop}
                    />
                </>
            );
        }

        render(<Harness />);

        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'SETTLE' }));

        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Create your first recipe' })).toBeTruthy();
    });

    it('suppresses the FAB in the empty state, where the empty CTA is the sole create control', () => {
        renderList({ status: 'ready', recipes: [] });

        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
        expect(screen.queryByRole('menu')).toBeNull();
        expect(screen.queryByRole('menuitem')).toBeNull();
        expect(screen.getByRole('button', { name: 'Create your first recipe' })).toBeTruthy();
    });

    it('wires the empty-state CTA to the create handler', () => {
        const onCreateRecipe = vi.fn();
        renderList({ status: 'ready', recipes: [], onCreateRecipe });

        fireEvent.click(screen.getByRole('button', { name: 'Create your first recipe' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
    });
});

// The switcher's own contract — roles, selected state, the resting affordance and its contrast floors, the
// 44pt targets — is owned by `RecipeSourceTabs.native.test.tsx` (ONE strip, shared with discovery). What
// belongs HERE is the composition, and that the active source still drives this view's Community behaviour.
describe('RecipeList (native) — source tabs (L5)', () => {
    it('renders no source switcher when no tab prop is given', () => {
        renderList({ status: 'ready', recipes: threeRecipes });

        expect(screen.queryByText('Community')).toBeNull();
    });

    it('mounts the shared switcher with the active source marked and both sources reachable', () => {
        const onChange = vi.fn();
        renderList({ status: 'ready', recipes: threeRecipes, tab: { active: 'mine', href: HREF, onChange } });

        expect(screen.getByRole('tab', { name: 'My Recipes' }).getAttribute('aria-selected')).toBe('true');
        fireEvent.click(screen.getByRole('tab', { name: 'Community' }));

        expect(onChange).toHaveBeenCalledWith('community');
    });

    it('shows the Community empty copy and NO FAB on the Community tab', () => {
        renderList({ status: 'ready', recipes: [], tab: { active: 'community', href: HREF, onChange: noop } });

        expect(screen.getByText('No community recipes')).toBeTruthy();
        // Both the dial's TRIGGER and its menu: a dial that rendered its panel while hiding the button would
        // still be a create affordance on someone else's library.
        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
        expect(screen.queryByRole('menu')).toBeNull();
        expect(screen.queryByRole('menuitem')).toBeNull();
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

/**
 * The quick-filter chips' SELECTED state has to reach assistive tech on the mobile-WEB build too, and
 * `accessibilityState={{ selected }}` alone does not get there (#114).
 *
 * Verified empirically against the installed react-native-web (0.20.0) rather than assumed: its
 * `forwardedProps` allowlist carries every literal `aria-*` attribute but has NO entry that projects
 * `accessibilityState` — its only consumer anywhere in the package is `AccessibilityUtil/isDisabled`, and even
 * that reads the LEGACY `accessibilityStates` array. A `<Pressable accessibilityState={{ selected: true }}>`
 * therefore renders `<button role="button" tabindex="0">` with no state attribute at all: correct on device
 * (VoiceOver/TalkBack read the native trait), silent on web, and unassertable in either place.
 *
 * The fix is `aria-pressed`, matching the web leaf's `<button aria-pressed>` exactly and the sibling
 * `RecipeFilterBar.native` chips, which already carry it. `aria-pressed` — not `aria-selected` — because these
 * are `role="button"` TOGGLES: ARIA supports `aria-selected` only on `option`/`tab`/`row`/`gridcell`-family
 * roles, so on a button it is an attribute AT does not have to honour. `accessibilityState` stays alongside it
 * because React Native has no `pressed` state and `selected` IS the device trait for a selected chip; RN maps
 * `aria-selected`/`aria-checked`/`aria-busy`/`aria-expanded`/`aria-disabled` into `accessibilityState` but NOT
 * `aria-pressed`, so dropping the object form would silence the device instead.
 */
describe('RecipeList (native) — the quick-filter chips announce their selected state on web too', () => {
    const withChips = (active: readonly string[]) =>
        renderList({
            status: 'ready',
            recipes: threeRecipes,
            filters: { available: ['Vegetarian', 'Italian'], active: [...active], onToggle: noop, onClear: noop },
        });

    it('marks an ACTIVE facet chip pressed', () => {
        withChips(['Italian']);

        expect(screen.getByRole('button', { name: 'Italian' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('marks an INACTIVE facet chip unpressed (present-and-false, not absent)', () => {
        // `aria-pressed` must be rendered as `false` rather than omitted: an omitted attribute makes the chip a
        // plain button, so a screen-reader user cannot tell an un-selected toggle from a one-shot action.
        withChips(['Italian']);

        expect(screen.getByRole('button', { name: 'Vegetarian' }).getAttribute('aria-pressed')).toBe('false');
    });

    it('marks the leading "All" chip pressed exactly when NO facet is active', () => {
        withChips([]);

        expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');

        cleanup();
        withChips(['Italian']);

        expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('false');
    });

    it('keeps the DEVICE trait alongside it — RN does not map `aria-pressed` into `accessibilityState`', () => {
        // react-native-web strips `accessibilityState` from the DOM, so it cannot be read back here. What CAN
        // be asserted is the invariant that actually protects the device: every chip that reports a pressed
        // state to the DOM is the same control that carries the object form. Pinning the prop on the rendered
        // element is impossible; pinning that the two states AGREE is not — so the web attribute is measured
        // against the model that also feeds `accessibilityState`.
        withChips(['Italian']);

        const pressed = screen
            .getAllByRole('button')
            .filter((button) => button.getAttribute('aria-pressed') === 'true')
            .map((button) => button.textContent);

        // Exactly the active facet — the "All" chip is unpressed because a facet IS active.
        expect(pressed).toEqual(['Italian']);
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

describe('RecipeList (native) — text contrast (WCAG 2.1 AA)', () => {
    // The source tabs' contrast — selected AND unselected, label AND boundary — moved with them to
    // `RecipeSourceTabs.native.test.tsx`, where the strip is measured once for both surfaces that mount it.
    it('keeps the search field’s PLACEHOLDER text legible on the field', () => {
        renderList({ status: 'ready', recipes: threeRecipes });

        // Placeholder copy is TEXT a reader reads — the field's only visible instruction before they type — so
        // it owes the 4.5:1 of SC 1.4.3; `placeholderTextColor={palette.mist}` measured 1.90:1 on the white
        // field. `placeholderContrast` reads the colour react-native-web actually paints (the
        // `--placeholderTextColor` custom property its compiled `::placeholder` rule resolves) and composites
        // the field's own opaque background over the screen, so this fails if the token drifts AND if the prop
        // stops being passed. Web's `placeholder:text-…` half is asserted in `RecipeList.test.tsx`.
        expect(
            placeholderContrast(screen.getByLabelText('Search recipes'), { surface: palette.sand }),
            'recipe-list search placeholder on its white field',
        ).toBeGreaterThanOrEqual(4.5);
    });
});
