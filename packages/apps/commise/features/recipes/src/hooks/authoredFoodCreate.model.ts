/**
 * @module authoredFoodCreate — the U16 create-your-own-food form's PURE half: the draft shape, its
 * validation, and the sub-state machine the platform leaves render.
 *
 * DESIGN PATTERN: the headless-hook seam's model file (CP-6/P2), the `ingredientResolver.model.ts`
 * sibling — no DOM, no React Native, no TanStack. The hook (`useIngredientResolver`) drives the
 * transitions; each leaf renders {@link AuthoredFoodCreateState} with an exhaustive switch.
 *
 * ## Validation is PURE and runs before any request leaves
 *
 * The bounds are the FOOD SERVICE's own (`@kitchensink/schema-recipe` composes them from
 * `@kitchensink/schema-food` — ADR-0014: one authority for name/macro bounds). Field errors are KEYS,
 * not sentences: each platform maps them onto its own localized copy, so the model stays
 * platform-and-locale-free.
 */
import { createAuthoredFoodViaPickerRequestSchema } from '@kitchensink/schema-recipe';
import type { CreateAuthoredFoodViaPickerRequest } from '@kitchensink/schema-recipe';

/** The four macro draft fields, as form TEXT (inputs hold strings; parsing is validation's job). */
export interface AuthoredFoodDraft {
    readonly name: string;
    readonly calories: string;
    readonly proteinG: string;
    readonly carbsG: string;
    readonly fatG: string;
}

/** A blank draft, name prefilled from the picker's query — the affordance's whole head start. */
export function draftFromQuery(query: string): AuthoredFoodDraft {
    return { name: query, calories: '', proteinG: '', carbsG: '', fatG: '' };
}

/** Why one draft field fails — a KEY each platform localizes, never a sentence. */
export type AuthoredFoodFieldError = 'required' | 'not_a_number' | 'out_of_range';

/** Per-field validation outcome. */
export type AuthoredFoodFieldErrors = Partial<Record<keyof AuthoredFoodDraft, AuthoredFoodFieldError>>;

/** The macro draft fields, iterated by validation and by both platform forms (stable order). */
export const AUTHORED_MACRO_FIELDS = ['calories', 'proteinG', 'carbsG', 'fatG'] as const;

/**
 * Validate a draft against the published bounds.
 *
 * @param draft - The form text.
 * @returns The parsed request, or the per-field error keys. Pure.
 */
export function validateAuthoredFoodDraft(
    draft: AuthoredFoodDraft,
):
    | { readonly ok: true; readonly value: CreateAuthoredFoodViaPickerRequest }
    | { readonly ok: false; readonly fieldErrors: AuthoredFoodFieldErrors } {
    const fieldErrors: Record<string, AuthoredFoodFieldError> = {};
    const macros: Record<string, number> = {};

    if (draft.name.trim().length === 0) {
        fieldErrors['name'] = 'required';
    }

    for (const field of AUTHORED_MACRO_FIELDS) {
        const text = draft[field].trim();

        if (text.length === 0) {
            fieldErrors[field] = 'required';
            continue;
        }

        const value = Number(text);

        if (!Number.isFinite(value)) {
            fieldErrors[field] = 'not_a_number';
            continue;
        }

        macros[field] = value;
    }

    if (Object.keys(fieldErrors).length > 0) {
        return { ok: false, fieldErrors };
    }

    // The published schema is the RANGE authority (0–100 g, 0–900 kcal, name length) — parsed, not
    // re-stated. A refusal here maps every offending path onto `out_of_range`.
    const parsed = createAuthoredFoodViaPickerRequestSchema.safeParse({
        name: draft.name,
        macros,
    });

    if (!parsed.success) {
        for (const issue of parsed.error.issues) {
            const head = issue.path[0] === 'macros' ? issue.path[1] : issue.path[0];

            if (typeof head === 'string') {
                fieldErrors[head] = 'out_of_range';
            }
        }

        return { ok: false, fieldErrors: Object.keys(fieldErrors).length > 0 ? fieldErrors : { name: 'out_of_range' } };
    }

    return { ok: true, value: parsed.data };
}

/**
 * The create-food sub-state a leaf renders. Orthogonal to `IngredientResolverViewState` on
 * purpose: the affordance rides the results/terminal states, and folding it into the main union would
 * multiply every existing kind by open/closed.
 */
export type AuthoredFoodCreateState =
    | { readonly kind: 'closed' }
    | {
          readonly kind: 'open';
          readonly draft: AuthoredFoodDraft;
          readonly fieldErrors: AuthoredFoodFieldErrors;
          /** A failed SUBMIT (network/server), retryable — distinct from field validation. */
          readonly submitFailed: boolean;
      }
    | { readonly kind: 'submitting'; readonly draft: AuthoredFoodDraft }
    | {
          /**
           * The per-author dedup collision (U16): the caller ALREADY authored a food with this name. The
           * reuse affordance admits that existing food onto the line — a different sentence and a
           * different action than generic validation copy, by design.
           */
          readonly kind: 'duplicate';
          readonly draft: AuthoredFoodDraft;
          readonly existingFoodId: string;
          /** Whether the reuse admission is in flight. */
          readonly reusePending: boolean;
          /** A failed reuse admission, retryable. */
          readonly reuseFailed: boolean;
      };
