/**
 * @module @commise/features-recipes/form — the recipe draft's transitions, as data: every action the draft admits, and
 * the resolved line its append carries. `applyDraftAction` (`./props.ts`) applies them. Types only, so the hooks that
 * dispatch an action import none of the form's helpers.
 */
import type { RecipeDifficulty, RecipeMealType } from '@kitchensink/recipe-core';

import type { SettledAnswer } from './ingredientStatus.js';
import type { LineBinding } from './lineBinding.js';
import type { IngredientLineKey } from './lineKey.js';
import type { RecipeFormIngredient, RecipeFormStep } from './values.js';

/**
 * An ingredient line that has RESOLVED to a catalog row — {@link RecipeFormIngredient} with its
 * `ingredientId` narrowed from `string | null` to `string`.
 *
 * DESIGN PATTERN: a domain-narrowed type used as a precondition (make illegal states unrepresentable). It
 * is the type-level half of U28's "no path can create an unresolved row": the `appendResolvedIngredient` action
 * (`./props.ts`) is the ONLY append transition the form has, and it cannot EXPRESS an unresolved line. The producer chain
 * is narrowed all the way back — `toIngredientLine` returns this, and the row editor's commit appends it — so a
 * container appending a line the cook never picked is a COMPILE error rather than a row that silently vanishes on
 * save.
 *
 * ⚠️ `RecipeFormIngredient.ingredientId` deliberately STAYS nullable. A draft restored from an older
 * source can genuinely hold an unresolved line, and the leaves must be able to render it and say why —
 * hiding it or dropping it is the failure the ingredient-entry brief names ("Do not design a row that
 * looks complete but is silently discarded"). What U28 removes is the ability to CREATE one, not the
 * ability to REPRESENT one.
 *
 * Plan 002 V1: it carries no `key`. The append action carries the key beside the line, minted at the edge by
 * `mintLineKey` (`./mintLineKey.ts`) from a source that never repeats, so a picked line cannot bring an identity of
 * its own and a new key cannot collide with any line's, present or removed.
 */
export type ResolvedRecipeFormIngredient = Omit<RecipeFormIngredient, 'key'> & { readonly ingredientId: string };

/** The two array fields a draft transition can remove from — identical behaviour, one key apart. */
export type DraftListField = 'ingredients' | 'steps';

/**
 * Every transition the recipe draft admits.
 *
 * DESIGN PATTERN: the variant half of a Visitor — `applyDraftAction`'s exhaustive switch (`./props.ts`) is the other
 * half, so a new member is a COMPILE error until it is handled rather than a silently ignored edit.
 */
export type DraftAction =
    | {
          readonly kind: 'appendResolvedIngredient';
          /** The new line's identity, minted at the edge (`mintLineKey`) so this transition stays pure. */
          readonly key: IngredientLineKey;
          readonly line: ResolvedRecipeFormIngredient;
      }
    | { readonly kind: 'removeAt'; readonly field: DraftListField; readonly index: number }
    | {
          readonly kind: 'updateIngredientAt';
          readonly index: number;
          /**
           * Only the four fields the cook edits on the row (§4a). The binding is not a key here, so no patch can unbind a
           * line; re-pointing one is {@link DraftAction} `rebindIngredient`.
           */
          readonly patch: Partial<Pick<RecipeFormIngredient, 'quantity' | 'unit' | 'preparation' | 'groupLabel'>>;
      }
    | {
          /**
           * The server's answers for polled or retried lines, applied as one transition. A draft action rather than a
           * value, because the answers land after a network call and must meet the draft as it is then.
           */
          readonly kind: 'settleIngredientLines';
          readonly answers: readonly SettledAnswer[];
      }
    | {
          readonly kind: 'rebindIngredient';
          /** By key, not index: a re-point lands after a network call, and a removal above moves every index. */
          readonly key: IngredientLineKey;
          readonly binding: LineBinding;
      }
    | {
          readonly kind: 'removeIngredient';
          /** By key, not index: a row's remove may run from a handler that closed over an earlier draft. */
          readonly key: IngredientLineKey;
      }
    | { readonly kind: 'updateStepAt'; readonly index: number; readonly patch: Partial<RecipeFormStep> }
    | { readonly kind: 'setIngredientQuantityLow'; readonly index: number; readonly value?: number }
    | { readonly kind: 'setIngredientQuantityHigh'; readonly index: number; readonly value?: number }
    | { readonly kind: 'addStep' }
    | { readonly kind: 'setDifficulty'; readonly value?: RecipeDifficulty }
    | { readonly kind: 'setMealType'; readonly value?: RecipeMealType };
