import { RecipeStatus } from '@kitchensink/recipe-core';

import { isCookable } from './cookability.js';
import type { CookabilityInput } from './cookability.js';

/** What a cook link knows about the recipe it names, and about the viewer. */
export interface CookLinkInput extends CookabilityInput {
    /** Whether the viewer owns the recipe. */
    readonly isOwner: boolean;
    /** Whether the viewer may read the recipe at all. `false` for a deleted recipe or one no longer theirs to read. */
    readonly readable: boolean;
}

/**
 * Where a cook link goes. `cook` runs cooking mode; `editor` sends a draft's owner to the editor (`001-FR-003b`);
 * `noSteps` and `gone` are the screen states S30 and S32. A redirect is navigation, never a screen state.
 *
 * Not here yet, on purpose: `recipeDetail`, which sends an owner's recipe that is IN REVIEW to its
 * detail page. Spec 020 adds it, test-first, together with the in-review reading as a required input. No compiler
 * check forces that, so 020's plan must name it.
 */
export type CookLinkOutcome = 'cook' | 'editor' | 'noSteps' | 'gone';

/**
 * Decides where a cook link goes. The route adapters act on the answer.
 *
 * An unreadable recipe is `gone` before anything else is read, so a link never tells a non-owner that a recipe is a
 * draft or has no steps; S32 never says why.
 *
 * @pattern Policy — a decision function that composes the {@link isCookable} Specification rather than restating it
 * @param input - The recipe's status and step count (steps with text, `cookingStepsOf`), and the viewer's relation.
 * @returns The outcome. Pure.
 */
export function cookLinkOutcome(input: CookLinkInput): CookLinkOutcome {
    if (!input.readable) {
        return 'gone';
    }

    if (input.status === RecipeStatus.DRAFT) {
        return input.isOwner ? 'editor' : 'gone';
    }

    return isCookable(input) ? 'cook' : 'noSteps';
}
