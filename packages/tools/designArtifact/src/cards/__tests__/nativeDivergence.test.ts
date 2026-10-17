/**
 * Holds `NativeDivergentComponents` (`../cardComponents.ts`) to the sources, so the list is not a one-time reading of
 * the component census. A component is typed ONCE from its web leaf unless its native leaf takes other props; if one
 * that is typed once ever diverges, its native column would be checked against web types and nothing would say so.
 *
 * The assertions are TYPE assertions: `tsc` (the package's typecheck, which includes this file) is what fails; the
 * runtime `it` only gives them a name. Shared entries must be equal, and each divergent entry must really differ, so a
 * stale entry (the leaves converged) fails too, and `renderNative` is not demanded of a card for nothing.
 */
import type { ComponentProps } from 'react';

import { describe, expectTypeOf, it } from 'vitest';

import type { EditorActionBar as EditorActionBarNative } from '#commise/features/recipes/src/editor/EditorActionBar.native';
import type { EditorActionBar } from '#commise/features/recipes/src/editor/EditorActionBar';
import type { EditorHeader as EditorHeaderNative } from '#commise/features/recipes/src/editor/EditorHeader.native';
import type { EditorHeader } from '#commise/features/recipes/src/editor/EditorHeader';
import type { EditorSection as EditorSectionNative } from '#commise/features/recipes/src/editor/EditorSection.native';
import type { EditorSection } from '#commise/features/recipes/src/editor/EditorSection';
import type { PublishLine as PublishLineNative } from '#commise/features/recipes/src/editor/PublishLine.native';
import type { PublishLine } from '#commise/features/recipes/src/editor/PublishLine';
import type { NutritionFigure as NutritionFigureNative } from '#commise/features/recipes/src/detail/NutritionFigure.native';
import type { NutritionFigure } from '#commise/features/recipes/src/detail/NutritionFigure';
import type { RecipeHero as RecipeHeroNative } from '#commise/features/recipes/src/detail/RecipeHero.native';
import type { RecipeHero } from '#commise/features/recipes/src/detail/RecipeHero';
import type { IngredientRow as IngredientRowNative } from '#commise/features/recipes/src/form/IngredientRow.native';
import type { IngredientRow } from '#commise/features/recipes/src/form/IngredientRow';
import type { HomeTabBar as HomeTabBarNative } from '#commise/mobile/src/components/home/chrome/HomeTabBar';
import type { HomeTabBar } from '#commise/web/src/components/home/chrome/HomeTabBar';
import type { FabFace as FabFaceNative } from '#commise/ui/src/createFab/FabFace.native';
import type { FabFace } from '#commise/ui/src/createFab/FabFace';

describe('the components typed once, from the web leaf, have the same props on native', () => {
    it('NutritionFigure', () => {
        expectTypeOf<ComponentProps<typeof NutritionFigure>>().toEqualTypeOf<
            ComponentProps<typeof NutritionFigureNative>
        >();
    });

    it('RecipeHero', () => {
        expectTypeOf<ComponentProps<typeof RecipeHero>>().toEqualTypeOf<ComponentProps<typeof RecipeHeroNative>>();
    });

    it('PublishLine', () => {
        expectTypeOf<ComponentProps<typeof PublishLine>>().toEqualTypeOf<ComponentProps<typeof PublishLineNative>>();
    });

    it('EditorSection', () => {
        expectTypeOf<ComponentProps<typeof EditorSection>>().toEqualTypeOf<
            ComponentProps<typeof EditorSectionNative>
        >();
    });

    it('FabFace', () => {
        expectTypeOf<ComponentProps<typeof FabFace>>().toEqualTypeOf<ComponentProps<typeof FabFaceNative>>();
    });
});

describe('the components in NativeDivergentComponents really do differ on native', () => {
    it('EditorHeader', () => {
        expectTypeOf<ComponentProps<typeof EditorHeader>>().not.toEqualTypeOf<
            ComponentProps<typeof EditorHeaderNative>
        >();
    });

    it('EditorActionBar', () => {
        expectTypeOf<ComponentProps<typeof EditorActionBar>>().not.toEqualTypeOf<
            ComponentProps<typeof EditorActionBarNative>
        >();
    });

    it('IngredientRow', () => {
        expectTypeOf<ComponentProps<typeof IngredientRow>>().not.toEqualTypeOf<
            ComponentProps<typeof IngredientRowNative>
        >();
    });

    it('HomeTabBar', () => {
        expectTypeOf<ComponentProps<typeof HomeTabBar>>().not.toEqualTypeOf<ComponentProps<typeof HomeTabBarNative>>();
    });
});
