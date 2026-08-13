/**
 * Native component tests for the recipe-detail view (rendered via react-native-web under jsdom). Mirrors
 * the web leaf across every content branch — header, meta, ingredients (incl. user-entered), instructions,
 * nutrition (complete vs partial), and photos (present vs absent) — so the two platform renders can't drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pressable, Text } from 'react-native';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { computedContrast } from '@commise/test-utils';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';

import { cssColor } from '../../__tests__/cssColor.js';

import {
    makeIngredientView,
    makeNutrition,
    makePhoto,
    makeRecipeDetail,
    makeStepView,
} from '../../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeDetailView } from '../RecipeDetailView.native.js';

afterEach(cleanup);

describe('RecipeDetailView (native)', () => {
    it('renders the title as a heading', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ title: 'Mediterranean Grilled Lamb' })} />);

        expect(screen.getByRole('heading', { name: 'Mediterranean Grilled Lamb' })).toBeTruthy();
    });

    // U8 brand leaf: the title must resolve to a REGISTERED Playfair face. A CSS font stack renders as the
    // system font on device with no error at all, so this reads the family react-native-web actually applied
    // (the class-compiled rule — `getComputedStyle` does not resolve it) and rejects any stack.
    it('paints the title in the registered bold Playfair face, never a CSS font stack', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ title: 'Lamb' })} />);

        const applied = appliedFontFamily(screen.getByRole('heading', { name: 'Lamb' }));

        expect(applied).toBe(nativeTokens.fontFace.display.bold);
        expect(applied).not.toContain(',');
    });

    it('sits the header in a brand gradient title band (U8)', () => {
        const { container } = render(<RecipeDetailView recipe={makeRecipeDetail({ title: 'Lamb' })} />);
        // The detail now paints MORE than one brand gradient (the hero's no-cover placeholder leads the
        // screen on this fixture), so identify the title band by what makes it the title band — it is the
        // gradient surface CONTAINING the heading — rather than by being the first gradient in the tree.
        const band = [...container.querySelectorAll('[data-commise-stub="linear-gradient"]')].find(
            (node) => node.querySelector('[role="heading"]') !== null,
        );

        expect(band).toBeDefined();
        expect(band?.querySelector('[role="heading"]')?.textContent).toBe('Lamb');
    });

    it('renders the description and badges', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ description: 'Tender and herby.', cuisine: 'Mediterranean' })}
            />,
        );

        expect(screen.getByText('Tender and herby.')).toBeTruthy();
        expect(screen.getByText('Mediterranean')).toBeTruthy();
    });

    it('renders meta times and servings', () => {
        render(
            <RecipeDetailView recipe={makeRecipeDetail({ prepTimeMinutes: 15, totalTimeMinutes: 45, servings: 4 })} />,
        );

        expect(screen.getByText('15 min')).toBeTruthy();
        expect(screen.getByText('45 min')).toBeTruthy();
        expect(screen.getByText('4')).toBeTruthy();
    });

    it('orders the stat cards Serves, Prep, Cook, Total (wireframe parity, C2)', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    prepTimeMinutes: 15,
                    cookTimeMinutes: 30,
                    totalTimeMinutes: 45,
                    servings: 4,
                })}
            />,
        );

        const labels = screen.getAllByText(/^(Serves|Prep|Cook|Total)$/).map((el) => el.textContent);
        expect(labels).toEqual(['Serves', 'Prep', 'Cook', 'Total']);
    });

    it('renders each ingredient with its formatted quantity and name', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    ingredients: [makeIngredientView({ name: 'Lamb leg', quantity: 1.5, unit: 'lbs' })],
                })}
            />,
        );

        expect(screen.getByText('Lamb leg')).toBeTruthy();
        expect(screen.getByText('1.5 lbs')).toBeTruthy();
    });

    it('marks user-entered ingredients with a badge', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ isUserEntered: true })] })}
            />,
        );

        expect(screen.getByText('Custom')).toBeTruthy();
    });

    it('renders a step instruction', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ steps: [{ stepNumber: 1, instruction: 'Rub the lamb.' }] })}
            />,
        );

        expect(screen.getByText('Rub the lamb.')).toBeTruthy();
    });

    it('renders the per-serving macros', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ nutrition: makeNutrition({ calories: 520, proteinG: 32 }) })}
            />,
        );

        expect(screen.getByText('520')).toBeTruthy();
        expect(screen.getByText('32 g')).toBeTruthy();
    });

    it('shows the estimated indicator only when nutrition is incomplete', () => {
        const { unmount } = render(
            <RecipeDetailView recipe={makeRecipeDetail({ nutrition: makeNutrition({ isComplete: false }) })} />,
        );
        expect(screen.getByText('Estimated — some items aren’t counted yet')).toBeTruthy();
        unmount();

        render(<RecipeDetailView recipe={makeRecipeDetail({ nutrition: makeNutrition({ isComplete: true }) })} />);
        expect(screen.queryByText('Estimated — some items aren’t counted yet')).toBeNull();
    });

    it('shows the standing USDA-source note when the recipe has a user-entered ingredient (REQ-034)', () => {
        // Distinct from the incomplete warning (D8): present even when nutrition IS complete, as long as the
        // recipe has a user-entered ingredient the note explains — never an unconditional standing fact.
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    nutrition: makeNutrition({ isComplete: true }),
                    ingredients: [makeIngredientView({ isUserEntered: true })],
                })}
            />,
        );

        expect(
            screen.getByText('Nutrition includes USDA database items; user-entered ingredients are marked Custom.'),
        ).toBeTruthy();
    });

    it('hides the standing USDA-source note when no ingredient is user-entered (REQ-034)', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ isUserEntered: false })] })}
            />,
        );

        expect(
            screen.queryByText('Nutrition includes USDA database items; user-entered ingredients are marked Custom.'),
        ).toBeNull();
    });

    it('hides the standing USDA-source note for a recipe with no ingredients (REQ-034)', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ ingredients: [] })} />);

        expect(
            screen.queryByText('Nutrition includes USDA database items; user-entered ingredients are marked Custom.'),
        ).toBeNull();
    });

    it('renders the photo gallery only when the recipe has photos', () => {
        const { unmount } = render(<RecipeDetailView recipe={makeRecipeDetail({ photos: [makePhoto()] })} />);
        expect(screen.getByLabelText('Recipe photos')).toBeTruthy();
        unmount();

        render(<RecipeDetailView recipe={makeRecipeDetail({ photos: [] })} />);
        expect(screen.queryByLabelText('Recipe photos')).toBeNull();
    });
});

describe('RecipeDetailView (native) — interactivity (D4/D5/D6)', () => {
    it('renders each ingredient as a checkbox reflecting the checked set (D5)', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    ingredients: [
                        makeIngredientView({ ingredientId: 'ing_1', name: 'Olive oil' }),
                        makeIngredientView({ ingredientId: 'ing_2', name: 'Garlic' }),
                    ],
                })}
                checkedIngredients={new Set(['ing_1'])}
            />,
        );

        // The ✓ glyph is the SIGHTED affordance; `aria-checked` is the assistive-tech one (asserted below).
        expect(screen.getByLabelText(/Olive oil/).getAttribute('role')).toBe('checkbox');
        expect(within(screen.getByLabelText(/Olive oil/)).queryByText('✓')).not.toBeNull();
        expect(within(screen.getByLabelText(/Garlic/)).queryByText('✓')).toBeNull();
    });

    it('invokes onToggleIngredient when an ingredient checkbox is pressed (D5)', async () => {
        const onToggleIngredient = vi.fn();
        const user = userEvent.setup();
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    ingredients: [makeIngredientView({ ingredientId: 'ing_9', name: 'Salt' })],
                })}
                onToggleIngredient={onToggleIngredient}
            />,
        );

        await user.click(screen.getByLabelText(/Salt/));

        expect(onToggleIngredient).toHaveBeenCalledWith('ing_9');
    });

    it('renders a per-step checkbox and toggles it (D4)', async () => {
        const onToggleStep = vi.fn();
        const user = userEvent.setup();
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ steps: [makeStepView({ stepNumber: 1, instruction: 'Rub the lamb.' })] })}
                checkedSteps={new Set()}
                onToggleStep={onToggleStep}
            />,
        );

        await user.click(screen.getByLabelText('Mark step 1 complete'));

        expect(onToggleStep).toHaveBeenCalledWith(1);
    });

    /**
     * The cook-mode checklists' CHECKED state has to reach assistive tech on the mobile-WEB build too, and
     * `accessibilityState={{ checked }}` alone does not get there (#123).
     *
     * Verified against the installed react-native-web (0.20.0): its `forwardedProps` allowlist carries every
     * literal `aria-*` attribute but has NO entry projecting `accessibilityState` — the only consumer anywhere
     * in the package, `AccessibilityUtil/isDisabled`, reads the LEGACY `accessibilityStates` array. Both
     * checklists therefore rendered `<button role="checkbox">` with no state attribute at all: correct on
     * device, silent on web. For a checkbox that is the whole control — the ✓ / numbered-marker swap and the
     * struck-through step text are SIGHTED affordances, so a screen-reader user cooking from this page had no
     * way to tell which ingredients they had gathered or which steps they had finished.
     *
     * `aria-checked` is what `role="checkbox"` takes — not `aria-selected` (valid only on
     * `option`/`tab`/`row`/`gridcell`-family roles) and not `aria-pressed` (a toggle-button attribute).
     * `accessibilityState` stays alongside it: RN reverse-maps `aria-checked` into `accessibilityState.checked`
     * (`Pressable.js`: `checked: ariaChecked ?? accessibilityState?.checked`), so the device trait survives.
     * This also restores parity with the web leaf, which already renders `role="checkbox" aria-checked` on both
     * checklists.
     */
    it('announces each INGREDIENT checkbox’s checked state to assistive tech (present-and-false, D5)', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    ingredients: [
                        makeIngredientView({ ingredientId: 'ing_1', name: 'Olive oil' }),
                        makeIngredientView({ ingredientId: 'ing_2', name: 'Garlic' }),
                    ],
                })}
                checkedIngredients={new Set(['ing_1'])}
            />,
        );

        expect(screen.getByLabelText(/Olive oil/).getAttribute('aria-checked')).toBe('true');
        // `false`, not absent: an omitted attribute leaves an un-gathered ingredient's state unknowable.
        expect(screen.getByLabelText(/Garlic/).getAttribute('aria-checked')).toBe('false');
    });

    it('announces each STEP checkbox’s checked state to assistive tech (present-and-false, D4)', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    steps: [
                        makeStepView({ stepNumber: 1, instruction: 'Rub the lamb.' }),
                        makeStepView({ stepNumber: 2, instruction: 'Grill the lamb.' }),
                    ],
                })}
                checkedSteps={new Set([1])}
            />,
        );

        expect(screen.getByLabelText('Mark step 1 complete').getAttribute('aria-checked')).toBe('true');
        expect(screen.getByLabelText('Mark step 2 complete').getAttribute('aria-checked')).toBe('false');
    });

    it('keeps the announced state in lockstep with the sighted ✓ / struck-through affordances', () => {
        // Mutation guard: a hard-coded or mis-wired attribute cannot keep BOTH channels naming the same row.
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    ingredients: [
                        makeIngredientView({ ingredientId: 'ing_1', name: 'Olive oil' }),
                        makeIngredientView({ ingredientId: 'ing_2', name: 'Garlic' }),
                    ],
                    steps: [
                        makeStepView({ stepNumber: 1, instruction: 'Rub the lamb.' }),
                        makeStepView({ stepNumber: 2, instruction: 'Grill the lamb.' }),
                    ],
                })}
                checkedIngredients={new Set(['ing_2'])}
                checkedSteps={new Set([2])}
            />,
        );

        const checked = screen
            .getAllByRole('checkbox')
            .filter((box) => box.getAttribute('aria-checked') === 'true')
            .map((box) => box.getAttribute('aria-label'));

        expect(checked).toEqual([expect.stringContaining('Garlic'), 'Mark step 2 complete']);
        expect(within(screen.getByLabelText(/Garlic/)).queryByText('✓')).not.toBeNull();
        expect(within(screen.getByLabelText('Mark step 2 complete')).queryByText('✓')).not.toBeNull();
    });

    it('invokes onFilterByTag when a tag chip is pressed (D6)', async () => {
        const onFilterByTag = vi.fn();
        const user = userEvent.setup();
        render(<RecipeDetailView recipe={makeRecipeDetail({ tags: ['grill'] })} onFilterByTag={onFilterByTag} />);

        await user.click(screen.getByLabelText('Find recipes tagged grill'));

        expect(onFilterByTag).toHaveBeenCalledWith('grill');
    });
});

describe('RecipeDetailView (native) — touch targets (U4 / RC-3)', () => {
    it('gives the ingredient checkbox a 44pt tap target', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    ingredients: [makeIngredientView({ ingredientId: 'ing_1', name: 'Olive oil' })],
                })}
                onToggleIngredient={vi.fn()}
            />,
        );

        const box = window.getComputedStyle(screen.getByLabelText(/Olive oil/));
        expect(box.width).toBe('44px');
        expect(box.height).toBe('44px');
    });

    it('gives the step marker a 44pt tap target', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ steps: [makeStepView({ stepNumber: 1, instruction: 'Rub the lamb.' })] })}
                onToggleStep={vi.fn()}
            />,
        );

        const marker = window.getComputedStyle(screen.getByLabelText('Mark step 1 complete'));
        expect(marker.width).toBe('44px');
        expect(marker.height).toBe('44px');
    });
});

describe('RecipeDetailView (native) — contrast (U4 / WCAG AA)', () => {
    it('renders tag chips with a slate (AA-legible) text colour, not the 2.2:1 coral', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ tags: ['grill'] })} onFilterByTag={vi.fn()} />);

        // The coral tint background stays; the tag TEXT is demoted to slate (rgb(99,110,114) ≈ 4.9:1). The old
        // coral-as-text (#E8917A) was 2.2:1.
        expect(window.getComputedStyle(screen.getByText('grill')).color).toBe('rgb(99, 110, 114)');
    });

    it('labels the SEAFOAM badge in ocean-dark, not the seafoam it is tinted with', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ cuisine: 'Mediterranean' })} />);

        // The badge row alternates seafoam and coral tints, and only the coral half was ever corrected —
        // seafoam-on-seafoam/10 is 3.57:1, still under the 4.5:1 body-text floor. `ocean-dark` is 5.51:1 and
        // keeps the badge in its own hue family. Mirrors the web leaf's `text-ocean-dark`.
        expect(window.getComputedStyle(screen.getByText('Mediterranean')).color).toBe(cssColor(palette['ocean-dark']));
        expect(window.getComputedStyle(screen.getByText('Mediterranean')).color).not.toBe(cssColor(palette.seafoam));
    });

    // Mirrors the web leaf's step-timer assertion. Measured as a RATIO, not as an equality against a token
    // spelling: an equality check would keep passing if the palette re-themed the token to near-white.
    it('makes the step timer label legible (4.02:1 as seafoam, under the 4.5:1 floor)', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    steps: [makeStepView({ stepNumber: 1, instruction: 'Rest the lamb.', timerSeconds: 120 })],
                })}
            />,
        );

        expect(computedContrast(screen.getByText('120s timer')), 'step timer label').toBeGreaterThanOrEqual(4.5);
    });
});

describe('RecipeDetailView (native) — version + visibility badges (D3)', () => {
    it('shows the current-version badge when past v1', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ currentVersion: 3 })} />);

        expect(screen.getByLabelText('Version 3')).toBeTruthy();
        expect(screen.getByText('v3')).toBeTruthy();
    });

    it('omits the version badge at v1', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ currentVersion: 1 })} />);

        expect(screen.queryByLabelText('Version 1')).toBeNull();
    });

    it('shows a Public badge for a public recipe', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ visibility: RecipeVisibility.PUBLIC })} />);

        expect(within(screen.getByLabelText('Recipe status')).getByText('Public')).toBeTruthy();
    });

    it('shows a Private badge for a private recipe', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ visibility: RecipeVisibility.PRIVATE })} />);

        expect(within(screen.getByLabelText('Recipe status')).getByText('Private')).toBeTruthy();
    });
});

describe('RecipeDetailView (native) — grouped footer (C3 wireframe parity)', () => {
    it('groups caller-supplied footerActions with the version + visibility badges in ONE footer row', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ currentVersion: 2, visibility: RecipeVisibility.PUBLIC })}
                footerActions={
                    <Pressable accessibilityRole="button" accessibilityLabel="Clone">
                        <Text>Clone</Text>
                    </Pressable>
                }
            />,
        );

        const footer = screen.getByLabelText('Recipe status');
        expect(within(footer).getByRole('button', { name: 'Clone' })).toBeTruthy();
        expect(within(footer).getByText('v2')).toBeTruthy();
        expect(within(footer).getByText('Public')).toBeTruthy();
    });

    it('renders no footerActions slot when the caller omits it (e.g. the owner viewing their own recipe)', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ currentVersion: 1 })} />);

        expect(screen.queryByRole('button', { name: 'Clone' })).toBeNull();
    });
});

describe('RecipeDetailView (native) — iOS shadow-clipping guard', () => {
    /**
     * The stat strip and the ingredient/step cards carry a tokenized `elevation.sm`. On iOS a layer masks
     * its OWN drop shadow the moment it also sets `overflow: 'hidden'` (Android's `elevation` does not), so
     * an elevated card must never clip. This guards that invariant across the whole detail surface — the
     * same structural rule `RecipeCard.native` enforces with its shell/content split.
     */
    it('never puts a card shadow and an overflow clip on the same node', () => {
        const { container } = render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    ingredients: [makeIngredientView({ name: 'Lamb' })],
                    steps: [makeStepView({ instruction: 'Grill it.' })],
                    nutrition: makeNutrition(),
                    photos: [makePhoto()],
                })}
            />,
        );

        const elevated = [...container.querySelectorAll<HTMLElement>('*')].filter(
            (node) => window.getComputedStyle(node).boxShadow !== '',
        );

        // The elevation is present (the guard would be vacuous if the shadows had simply been dropped)…
        expect(elevated.length).toBeGreaterThan(0);

        // …and no elevated node clips.
        for (const node of elevated) {
            expect(window.getComputedStyle(node).overflowX).not.toBe('hidden');
        }
    });
});

describe('RecipeDetailView (native) — hero cover (mockup screen-recipe-detail)', () => {
    /**
     * The hero cover, addressed by the `<img alt>` react-native-web renders for it. Deliberately NOT
     * `getByLabelText(title)`: the detail's own root View is labelled with the recipe title too, so a
     * label query would match the container and PASS even with no hero rendered at all.
     */
    const heroCover = (container: HTMLElement, title: string): HTMLImageElement | null =>
        container.querySelector<HTMLImageElement>(`img[alt="${title}"]`);

    it('LEADS the screen with the cover hero — it precedes the title heading in document order', () => {
        const { container } = render(
            <RecipeDetailView recipe={makeRecipeDetail({ title: 'Lamb', coverPhotoUrl: 'https://cdn/hero.jpg' })} />,
        );
        const hero = heroCover(container, 'Lamb');
        const heading = screen.getByRole('heading', { name: 'Lamb' });

        expect(hero).not.toBeNull();
        // DOCUMENT_POSITION_FOLLOWING (4) — the heading comes AFTER the hero, i.e. the hero leads the screen.
        const relation = hero === null ? 0 : hero.compareDocumentPosition(heading);
        expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('sources the hero from coverPhotoUrl, NOT from photos[0]', () => {
        const { container } = render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    title: 'Lamb',
                    coverPhotoUrl: 'https://cdn/cover.jpg',
                    photos: [makePhoto({ url: 'https://cdn/gallery-first.jpg' })],
                })}
            />,
        );

        // The hero and the card must never disagree about which image represents the recipe, so the hero reads
        // the canonical cover. A `photos[0]` hero would silently diverge the moment a gallery is reordered.
        expect(container.innerHTML).toContain('https://cdn/cover.jpg');
    });

    it('renders the deliberate no-photo hero fallback for a recipe with no cover', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ title: 'Lamb', coverPhotoUrl: undefined, photos: [] })} />);

        expect(screen.getByLabelText('No photo yet')).toBeTruthy();
        // And the title still renders — a missing cover degrades the hero, never the screen.
        expect(screen.getByRole('heading', { name: 'Lamb' })).toBeTruthy();
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
/**
 * Resolve the value react-native-web actually APPLIED for a CSS property, by walking the element's atomic
 * `r-*` classes back to their compiled rules and falling back to the inline `style` attribute. Same helper as
 * `CollectionHeader.native.test.tsx` / `RecipeFilterBar.native.test.tsx`, which established the idiom.
 */
function appliedStyle(element: Element, property: string): string | undefined {
    const classNames = element.className.split(' ').filter((name) => name.startsWith('r-'));
    const sheets = document.styleSheets;
    let resolved: string | undefined;

    for (const className of classNames) {
        for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
            const rules = sheets[sheetIndex]?.cssRules;

            for (let ruleIndex = 0; ruleIndex < (rules?.length ?? 0); ruleIndex += 1) {
                const rule = rules?.[ruleIndex];

                if (rule instanceof CSSStyleRule && rule.selectorText === `.${className}`) {
                    const value = rule.style.getPropertyValue(property);

                    if (value !== '') {
                        resolved = value;
                    }
                }
            }
        }
    }

    return (resolved ?? (element as HTMLElement).style.getPropertyValue(property)) || undefined;
}

/**
 * Regression sweep (same family as `CollectionHeader.native.tsx`'s clipped Rename / absent Delete): the
 * ingredient checklist row is `[44pt checkbox][qty][name][notes][Custom badge]` on one non-wrapping line with
 * the badge pushed right by `marginLeft: 'auto'`, and React Native defaults `flexShrink` to 0 — so a long
 * ingredient name plus notes claimed their full intrinsic width and pushed the badge (and the notes
 * themselves) past the card and screen edge. Two of the three variable-length values in this row come
 * straight from user data, so it needs no unusual recipe to hit.
 *
 * jsdom has no layout engine, so this pins the flex CONTRACT: the user-supplied text yields width, the fixed
 * chrome (the 44pt tap target, the badge) never does.
 */
describe('RecipeDetailView (native) — a long ingredient line cannot push the row chrome off the screen', () => {
    const longIngredient = () =>
        makeRecipeDetail({
            ingredients: [
                makeIngredientView({
                    name: 'Slow-roasted San Marzano tomatoes from the co-op down the road',
                    notes: 'peeled, deseeded, and crushed by hand just before serving',
                    isUserEntered: true,
                }),
            ],
        });

    it('lets the ingredient name and its notes shrink instead of claiming their intrinsic width', () => {
        render(<RecipeDetailView recipe={longIngredient()} />);

        const name = screen.getByText('Slow-roasted San Marzano tomatoes from the co-op down the road');
        const notes = screen.getByText('peeled, deseeded, and crushed by hand just before serving');

        expect(appliedStyle(name, 'flex-shrink')).toBe('1');
        expect(appliedStyle(notes, 'flex-shrink')).toBe('1');
    });

    it('never shrinks the trailing user-entered badge, so it cannot be clipped away', () => {
        render(<RecipeDetailView recipe={longIngredient()} />);

        expect(appliedStyle(screen.getByText('Custom'), 'flex-shrink')).toBe('0');
    });

    it('never shrinks the 44pt checkbox tap target', () => {
        render(<RecipeDetailView recipe={longIngredient()} />);

        // The ingredient's own tick box (the step list carries checkboxes of its own).
        const checkbox = screen.getByRole('checkbox', { name: /Slow-roasted San Marzano tomatoes/ });

        expect(appliedStyle(checkbox, 'flex-shrink')).toBe('0');
        // The touch floor the row must not compromise (RC-3).
        expect(appliedStyle(checkbox, 'width')).toBe('44px');
        expect(appliedStyle(checkbox, 'height')).toBe('44px');
    });
});

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

describe('RecipeDetailView (native) — step marker done/not-done parity (#113)', () => {
    /** The visible 32px marker circle inside the step's 44pt tap target. */
    const markerOf = (step: number): Element => {
        const visual = screen.getByLabelText(`Mark step ${step} complete`).firstElementChild;

        if (visual === null) {
            throw new Error('Expected the step toggle to wrap a visible marker circle.');
        }

        return visual;
    };

    const renderStep = (checked: readonly number[]) =>
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ steps: [makeStepView({ stepNumber: 1, instruction: 'Rub the lamb.' })] })}
                checkedSteps={new Set(checked)}
                onToggleStep={vi.fn()}
            />,
        );

    it('paints the two states DIFFERENTLY — a done step must be tellable from a pending one', () => {
        // `stepMarkerDone` set `backgroundColor: palette.seafoam` on a base style that ALREADY did, so the
        // done-state override was a no-op and both states rendered the identical filled seafoam disc. The
        // checkmark-vs-numeral glyph was the only difference, on a fill neither state could be read against.
        renderStep([]);
        const pending = window.getComputedStyle(markerOf(1)).backgroundColor;

        cleanup();
        renderStep([1]);
        const done = window.getComputedStyle(markerOf(1)).backgroundColor;

        expect(done, 'the done marker paints the seafoam fill').toBe(cssColor(palette.seafoam));
        expect(pending, 'the pending marker must NOT paint that same fill').not.toBe(done);
    });

    it('mirrors the web leaf: pending is an OUTLINE with a dark numeral, done is a filled disc with a white tick', () => {
        // Web renders `border-2 border-seafoam text-ocean-dark` pending and `bg-seafoam text-white` done. Native
        // rendered white-on-seafoam for BOTH, so the platforms disagreed on the state's whole appearance.
        renderStep([]);
        const numeral = within(screen.getByLabelText('Mark step 1 complete')).getByText('1');

        expect(window.getComputedStyle(numeral).color, 'pending numeral tone').toBe(cssColor(palette['ocean-dark']));
        expect(computedContrast(numeral), 'pending step numeral').toBeGreaterThanOrEqual(4.5);
        // Pending, the ring IS the affordance, so it owes the 3:1 of SC 1.4.11 on its own.
        expect(window.getComputedStyle(markerOf(1)).borderTopColor).toBe(cssColor(palette.seafoam));

        cleanup();
        renderStep([1]);
        const tick = within(screen.getByLabelText('Mark step 1 complete')).getByText('✓');

        expect(computedContrast(tick, { surface: palette.seafoam }), 'done step tick').toBeGreaterThanOrEqual(4.5);
    });
});
