// @vitest-environment jsdom
/**
 * Component tests for the web recipe-detail view. Covers every content branch T066 requires — header
 * (title, description, badges), meta (times + servings), ingredients (quantity/unit/notes/user-entered),
 * instructions (ordered, optional timer), nutrition (complete vs partial/estimated), and photos (present
 * vs absent) — asserting on role/name/text so a missing section or a dropped branch fails.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecipeVisibility } from '@kitchensink/recipe-core';

import { utilityContrast } from '@commise/test-utils';

import {
    makeIngredientView,
    makeNutrition,
    makePhoto,
    makeRecipeDetail,
    makeStepView,
} from '../../__fixtures__/index.js';
import { RecipeDetailView } from '../RecipeDetailView.js';

afterEach(cleanup);

describe('RecipeDetailView (web) — header', () => {
    it('renders the title as the top-level heading', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ title: 'Mediterranean Grilled Lamb' })} />);

        expect(screen.getByRole('heading', { level: 1, name: 'Mediterranean Grilled Lamb' })).toBeTruthy();
    });

    it('sits the header in a brand gradient title band (U8)', () => {
        const { container } = render(<RecipeDetailView recipe={makeRecipeDetail({ title: 'Lamb' })} />);
        // The GradientSurface paints an inline linear-gradient background behind the header. Selected by the
        // band that CONTAINS the h1 — not merely "the first gradient on the screen", so another gradient
        // surface elsewhere on the detail (e.g. the hero's no-cover placeholder) cannot satisfy this by accident.
        const band = Array.from(container.querySelectorAll<HTMLElement>('*')).find(
            (el) => el.style.backgroundImage.startsWith('linear-gradient') && el.querySelector('h1') !== null,
        );

        expect(band).toBeDefined();
    });

    it('renders the description', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ description: 'Tender and herby.' })} />);

        expect(screen.getByText('Tender and herby.')).toBeTruthy();
    });

    it('sizes the title responsively — smaller at base, the original text-4xl from sm up (U5)', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ title: 'Mediterranean Grilled Lamb' })} />);

        // A long title overflows a 360px viewport at text-4xl, so the base drops to text-2xl and restores the
        // original text-4xl at `sm:` — tablet/desktop are unchanged.
        const heading = screen.getByRole('heading', { level: 1, name: 'Mediterranean Grilled Lamb' });
        expect(heading.className).toContain('text-2xl');
        expect(heading.className).toContain('sm:text-4xl');
    });

    it('renders cuisine, dietary flags, and tags as badges', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ cuisine: 'Mediterranean', dietaryFlags: ['Gluten-Free'], tags: ['grill'] })}
            />,
        );

        expect(screen.getByText('Mediterranean')).toBeTruthy();
        expect(screen.getByText('Gluten-Free')).toBeTruthy();
        expect(screen.getByText('grill')).toBeTruthy();
    });

    it('makes EVERY badge in the hero row WCAG-AA legible over its own tint', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ cuisine: 'Mediterranean', dietaryFlags: ['Gluten-Free'], tags: ['grill'] })}
            />,
        );

        // The row alternates a seafoam-tinted badge with a coral-tinted one, so a fix that only reaches the
        // coral half leaves the other still failing. Both scored below the 4.5:1 body-text floor — coral-on-
        // coral at 2.06:1, seafoam-on-seafoam at 3.56:1 — and both are asserted here so neither can drift.
        for (const label of ['Mediterranean', 'Gluten-Free']) {
            const badge = screen.getByText(label);

            expect(utilityContrast(badge.className), `${label} badge`).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('makes the tappable tag chip WCAG-AA legible AT REST AND ON HOVER', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ tags: ['grill'] })} />);

        const chip = screen.getByRole('button', { name: 'Find recipes tagged grill' });

        // Hover is a state, not decoration: this chip deepens its tint on hover, so a label that clears the
        // floor at rest can be pushed back under it by the pointer alone (slate over `bg-coral/25` is
        // 4.26:1). Both states are measured, so a hover-only regression cannot slip through.
        expect(utilityContrast(chip.className)).toBeGreaterThanOrEqual(4.5);
        expect(utilityContrast(chip.className, { variant: 'hover' })).toBeGreaterThanOrEqual(4.5);
    });
});

/**
 * The hero badge row and the tag chip above are already measured; these are the three seafoam-as-TEXT leaves
 * further down the page that the same pass left under the floor. Which seafoam sites are accents (3:1) and
 * which are text (4.5:1) is stated once, in `@commise/ui`'s palette JSDoc.
 */
describe('RecipeDetailView (web) — seafoam-as-text below the hero is WCAG-AA legible', () => {
    it('makes the NOT-DONE step numeral legible (the reader reads the number)', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ steps: [makeStepView({ stepNumber: 1, instruction: 'Rub the lamb.' })] })}
                checkedSteps={new Set()}
                onToggleStep={vi.fn()}
            />,
        );

        // The not-done marker is an OUTLINED circle whose numeral is the only thing in it — seafoam on the
        // page surface is 4.02:1. The `border-seafoam` ring stays seafoam (a 3:1 graphic, which it clears).
        const numeral = within(screen.getByRole('checkbox', { name: 'Mark step 1 complete' })).getByText('1');

        expect(utilityContrast(numeral.className), 'not-done step numeral').toBeGreaterThanOrEqual(4.5);
    });

    it('makes the step timer label legible', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    steps: [makeStepView({ stepNumber: 1, instruction: 'Rest the lamb.', timerSeconds: 120 })],
                })}
            />,
        );

        expect(utilityContrast(screen.getByText('120s timer').className), 'step timer').toBeGreaterThanOrEqual(4.5);
    });

    it('makes the footer visibility badge legible over its seafoam tint', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ visibility: RecipeVisibility.PUBLIC })} />);

        const badge = within(screen.getByRole('group', { name: 'Recipe status' })).getByText('Public');

        expect(utilityContrast(badge.className), 'footer visibility badge').toBeGreaterThanOrEqual(4.5);
    });
});

describe('RecipeDetailView (web) — meta', () => {
    it('renders prep, cook, total times and servings', () => {
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

        expect(screen.getByText('15 min')).toBeTruthy();
        expect(screen.getByText('30 min')).toBeTruthy();
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
});

describe('RecipeDetailView (web) — ingredients', () => {
    it('renders each ingredient with its formatted quantity and name', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    ingredients: [makeIngredientView({ name: 'Lamb leg', quantity: 1.5, unit: 'lbs' })],
                })}
            />,
        );

        const ingredients = screen.getByRole('region', { name: 'Ingredients' });
        expect(within(ingredients).getByText('Lamb leg')).toBeTruthy();
        expect(within(ingredients).getByText('1.5 lbs')).toBeTruthy();
    });

    it('renders ingredient notes when present', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ notes: 'butterflied' })] })}
            />,
        );

        expect(screen.getByText('butterflied')).toBeTruthy();
    });

    it('marks user-entered ingredients with a badge', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ isUserEntered: true })] })}
            />,
        );

        expect(screen.getByText('Custom')).toBeTruthy();
    });

    it('does not show the custom badge for resolved ingredients', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ isUserEntered: false })] })}
            />,
        );

        expect(screen.queryByText('Custom')).toBeNull();
    });
});

describe('RecipeDetailView (web) — instructions', () => {
    it('renders steps in an ordered list', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    steps: [
                        makeStepView({ stepNumber: 1, instruction: 'Rub the lamb.' }),
                        makeStepView({ stepNumber: 2, instruction: 'Grill each side.' }),
                    ],
                })}
            />,
        );

        const steps = screen.getByRole('region', { name: 'Instructions' });
        const list = within(steps).getByRole('list');
        const items = within(list).getAllByRole('listitem');
        expect(items).toHaveLength(2);
        expect(within(items[0]!).getByText('Rub the lamb.')).toBeTruthy();
        expect(within(items[1]!).getByText('Grill each side.')).toBeTruthy();
    });
});

describe('RecipeDetailView (web) — nutrition', () => {
    it('renders the per-serving macros', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    nutrition: makeNutrition({ calories: 520, proteinG: 32, carbsG: 18, fatG: 34 }),
                })}
            />,
        );

        const nutrition = screen.getByRole('region', { name: 'Nutrition (per serving)' });
        expect(within(nutrition).getByText('520')).toBeTruthy();
        expect(within(nutrition).getByText('32 g')).toBeTruthy();
    });

    it('shows an estimated indicator when nutrition is incomplete', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ nutrition: makeNutrition({ isComplete: false }) })} />);

        expect(screen.getByText('Estimated — some items aren’t counted yet')).toBeTruthy();
    });

    it('hides the estimated indicator when nutrition is complete', () => {
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

        const nutrition = screen.getByRole('region', { name: 'Nutrition (per serving)' });
        expect(
            within(nutrition).getByText(
                'Nutrition includes USDA database items; user-entered ingredients are marked Custom.',
            ),
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
});

describe('RecipeDetailView (web) — photos', () => {
    it('renders each photo with an accessible name', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ title: 'Grilled Lamb', photos: [makePhoto({ url: 'https://cdn/x.jpg' })] })}
            />,
        );

        expect(screen.getByRole('img', { name: 'Grilled Lamb photo 1' })).toBeTruthy();
    });

    it('renders no photo gallery when the recipe has no photos', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ photos: [] })} />);

        // The GALLERY is absent — asserted on the carousel's own region and its slide controls, not on "no
        // image anywhere on the screen": the detail now also leads with the cover hero, which is a different
        // element driven by `coverPhotoUrl` rather than by `photos`.
        expect(screen.queryByRole('region', { name: 'Recipe photos' })).toBeNull();
        expect(screen.queryByRole('button', { name: /full screen$/ })).toBeNull();
    });

    it('renders no photo gallery even when a cover hero IS present (they are independent)', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ photos: [], coverPhotoUrl: 'https://cdn/hero.jpg' })} />);

        expect(screen.queryByRole('region', { name: 'Recipe photos' })).toBeNull();
        // …while the hero still paints the cover (alt text = the recipe title).
        expect(screen.getByRole('img', { name: 'Weeknight Pasta' })).toBeTruthy();
    });
});

describe('RecipeDetailView (web) — interactivity (D4/D5/D6)', () => {
    it('renders each ingredient as a real checkbox reflecting the checked set (D5)', () => {
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

        expect(screen.getByRole('checkbox', { name: /Olive oil/ }).getAttribute('aria-checked')).toBe('true');
        expect(screen.getByRole('checkbox', { name: /Garlic/ }).getAttribute('aria-checked')).toBe('false');
    });

    it('gives the ingredient checkbox a 44px base touch target around a smaller visual box, reset at sm (U5)', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    ingredients: [makeIngredientView({ ingredientId: 'ing_1', name: 'Olive oil' })],
                })}
                checkedIngredients={new Set(['ing_1'])}
            />,
        );

        // The interactive control (the button carrying role=checkbox) is the tap target: `size-11` (44px) at
        // base, `sm:size-6` back to 24px on wider viewports. The visible tick box is a nested element sized
        // `size-8 sm:size-6` (32px mobile, 24px desktop), so the mobile target grows without enlarging the
        // desktop glyph.
        //
        // These indices shifted from `size-6 sm:size-5` with NO change in painted pixels: the DS used to
        // redefine Tailwind's `--spacing-*` scale, so the old classes resolved to the same 32/24px. Note this
        // asserts CLASS STRINGS — jsdom computes no layout, so it cannot prove a length. The pixel contract
        // is enforced by Playwright's `boundingBox()` in `recipeHomeResponsive.spec.ts`, and the meaning of
        // each utility by the compiled-CSS test in `web/tests/__integration__/tailwindTheme`.
        const box = screen.getByRole('checkbox', { name: /Olive oil/ });
        expect(box.className).toContain('size-11');
        expect(box.className).toContain('sm:size-6');

        const visual = box.firstElementChild as HTMLElement | null;
        expect(visual).not.toBeNull();
        expect(visual?.className).toContain('size-8');
        expect(visual?.className).toContain('sm:size-6');
    });

    it('makes the UNCHECKED ingredient checkbox perceivable — its border is all there is', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    ingredients: [makeIngredientView({ ingredientId: 'ing_1', name: 'Olive oil' })],
                })}
                checkedIngredients={new Set()}
            />,
        );

        // Unchecked, the box paints no fill and holds no glyph, so its OUTLINE is the entire affordance — a
        // UI component under SC 1.4.11, floor 3:1. `border-mist` was 1.90:1, failing even that lower bar.
        // The native leaf was demoted to slate in the U4 pass and carries a comment saying exactly this; the
        // web half was never brought along, which is the drift this asserts shut.
        const visual = screen.getByRole('checkbox', { name: /Olive oil/ }).firstElementChild;

        expect(visual).not.toBeNull();
        expect(
            utilityContrast(visual?.className ?? '', { foreground: 'border' }),
            'unchecked ingredient checkbox outline',
        ).toBeGreaterThanOrEqual(3);
    });

    it('invokes onToggleIngredient with the ingredient id when its checkbox is activated (D5)', async () => {
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

        await user.click(screen.getByRole('checkbox', { name: /Salt/ }));

        expect(onToggleIngredient).toHaveBeenCalledWith('ing_9');
    });

    it('renders a per-step completion checkbox and toggles it (D4)', async () => {
        const onToggleStep = vi.fn();
        const user = userEvent.setup();
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ steps: [makeStepView({ stepNumber: 1, instruction: 'Rub the lamb.' })] })}
                checkedSteps={new Set()}
                onToggleStep={onToggleStep}
            />,
        );

        const stepBox = screen.getByRole('checkbox', { name: 'Mark step 1 complete' });
        expect(stepBox.getAttribute('aria-checked')).toBe('false');

        await user.click(stepBox);

        expect(onToggleStep).toHaveBeenCalledWith(1);
    });

    it('reflects a checked step from the checked set (D4)', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ steps: [makeStepView({ stepNumber: 2, instruction: 'Sear.' })] })}
                checkedSteps={new Set([2])}
            />,
        );

        expect(screen.getByRole('checkbox', { name: 'Mark step 2 complete' }).getAttribute('aria-checked')).toBe(
            'true',
        );
    });

    it('renders tags as tappable chips that invoke onFilterByTag (D6)', async () => {
        const onFilterByTag = vi.fn();
        const user = userEvent.setup();
        render(<RecipeDetailView recipe={makeRecipeDetail({ tags: ['grill'] })} onFilterByTag={onFilterByTag} />);

        await user.click(screen.getByRole('button', { name: 'Find recipes tagged grill' }));

        expect(onFilterByTag).toHaveBeenCalledWith('grill');
    });
});

describe('RecipeDetailView (web) — version + visibility badges (D3)', () => {
    it('shows the current-version badge when the recipe is past v1', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ currentVersion: 3 })} />);

        expect(screen.getByLabelText('Version 3').textContent).toBe('v3');
    });

    it('omits the version badge at v1 (nothing to signal)', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ currentVersion: 1 })} />);

        expect(screen.queryByLabelText('Version 1')).toBeNull();
    });

    it('shows a Public badge for a public recipe', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ visibility: RecipeVisibility.PUBLIC })} />);

        expect(within(screen.getByRole('group', { name: 'Recipe status' })).getByText('Public')).toBeTruthy();
    });

    it('shows a Private badge for a private recipe', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ visibility: RecipeVisibility.PRIVATE })} />);

        expect(within(screen.getByRole('group', { name: 'Recipe status' })).getByText('Private')).toBeTruthy();
    });
});

describe('RecipeDetailView (web) — grouped footer (C3 wireframe parity)', () => {
    it('groups caller-supplied footerActions with the version + visibility badges in ONE footer row', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ currentVersion: 2, visibility: RecipeVisibility.PUBLIC })}
                footerActions={
                    <button type="button" onClick={() => undefined}>
                        Clone
                    </button>
                }
            />,
        );

        const footer = screen.getByRole('group', { name: 'Recipe status' });
        expect(within(footer).getByRole('button', { name: 'Clone' })).toBeTruthy();
        expect(within(footer).getByText('v2')).toBeTruthy();
        expect(within(footer).getByText('Public')).toBeTruthy();
    });

    it('renders no footerActions slot when the caller omits it (e.g. the owner viewing their own recipe)', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ currentVersion: 1 })} />);

        expect(screen.queryByRole('button', { name: 'Clone' })).toBeNull();
    });
});

describe('RecipeDetailView (web) — hero cover (mockup screen-recipe-detail)', () => {
    it('LEADS the screen with the cover hero — it precedes the title heading in document order', () => {
        const { container } = render(
            <RecipeDetailView recipe={makeRecipeDetail({ title: 'Lamb', coverPhotoUrl: 'https://cdn/hero.jpg' })} />,
        );
        const hero = screen.getByRole('img', { name: 'Lamb' });
        const heading = screen.getByRole('heading', { level: 1, name: 'Lamb' });

        expect(container.contains(hero)).toBe(true);
        // DOCUMENT_POSITION_FOLLOWING (4) — the heading comes AFTER the hero, i.e. the hero leads the screen.
        expect(hero.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('renders the deliberate no-photo hero fallback for a recipe with no cover', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ title: 'Lamb', coverPhotoUrl: undefined, photos: [] })} />);

        expect(screen.getByRole('img', { name: 'No photo yet' })).toBeTruthy();
        // And the title still renders — a missing cover degrades the hero, never the screen.
        expect(screen.getByRole('heading', { level: 1, name: 'Lamb' })).toBeTruthy();
    });
});

describe('RecipeDetailView (web) — touch targets (44px floor)', () => {
    it('gives the step toggle a 44px base touch target around its smaller visual marker, reset at sm', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ steps: [makeStepView({ stepNumber: 1 })] })} />);
        const control = screen.getByRole('checkbox', { name: 'Mark step 1 complete' });

        // The tap target is the interactive control: 44px (`size-11`) on touch, collapsing to the original
        // 32px marker density (`sm:size-8`) from sm up so the desktop step list is unchanged.
        expect(control.className).toContain('size-11');
        expect(control.className).toContain('sm:size-8');
        // The visible marker stays the compact circle, nested inside the larger target.
        expect(control.querySelector('[class*="size-8"]')).not.toBeNull();
    });

    it('gives each tag-filter chip the 44px touch floor, reset for the mouse at md', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ tags: ['grill'] })} />);
        const chip = screen.getByRole('button', { name: 'Find recipes tagged grill' });

        expect(chip.className).toContain('min-h-11');
        expect(chip.className).toContain('md:min-h-0');
    });
});

/**
 * Cross-platform parity for the native leaf's ingredient-row fix. CSS flex items shrink by default, so this
 * leaf degraded more gracefully than RN — but `min-width: auto` still lets a single long token overflow the
 * card, and the trailing `Custom` badge was itself shrinkable (its pill would deform before the text yielded).
 * Pinning both keeps the two leaves' overflow behaviour from drifting again.
 */
describe('RecipeDetailView (web) — a long ingredient line cannot push the row chrome off the screen', () => {
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

    it('lets the ingredient name shrink and wrap rather than overflow the row', () => {
        render(<RecipeDetailView recipe={longIngredient()} />);

        const name = screen.getByText('Slow-roasted San Marzano tomatoes from the co-op down the road');

        expect(name.className).toContain('min-w-0');
        expect(name.className).toContain('break-words');
    });

    it('never shrinks the fixed-format quantity or the trailing user-entered badge', () => {
        render(<RecipeDetailView recipe={longIngredient()} />);

        // Both are the row's CHROME: the quantity is a formatted fixed field and the badge is a pill — RN
        // leaves them unshrinkable by default, so web says so explicitly.
        expect(screen.getByText('2 tbsp').className).toContain('shrink-0');
        expect(screen.getByText('Custom').className).toContain('shrink-0');
    });
});
