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
 *
 * ## ⛔ EVERY FIELD IS ASKED ABOUT ITS OWN VALUE — presence AND range in ONE pass
 *
 * This ran the presence/number checks over all five fields, RETURNED if any of them failed, and only
 * then handed the whole object to the schema. So the range authority never ran while any field was blank
 * — a cook who typed `150` into Carbs and had not reached the other three yet saw three `Required`s and
 * NOTHING on the field actually at fault. The bad value only named itself on a SECOND submit, after
 * everything else was already correct, which made "inline validation renders per field" true of two of
 * the three verdicts and quietly false of the third.
 *
 * ⚠️ The repair is NOT a local re-statement of the bounds. Each field is parsed against ITS OWN published
 * sub-schema, reached through `.shape` — the same declaration the whole-object parse uses, one level
 * down — so there is still exactly one authority for what 0–100 g and 0–900 kcal mean, and a bound that
 * moves in `@kitchensink/schema-food` moves here with it. The whole-object parse still runs last and is
 * still what produces the typed request.
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
 * The published request's OWN field declarations, reached one level down rather than restated.
 *
 * ⛔ `.shape` is the schema's declaration, not a copy of it: `name` here IS the string schema the
 * whole-object parse applies, and {@link AUTHORED_MACRO_SCHEMAS} likewise for each macro. That is what
 * lets validation answer per field without giving the bounds a second authority (ADR-0014).
 */
const AUTHORED_FIELD_SCHEMAS = createAuthoredFoodViaPickerRequestSchema.shape;

/** The per-100g macro bounds, per field — the food service's own `authoredMacrosSchema` members. */
const AUTHORED_MACRO_SCHEMAS = AUTHORED_FIELD_SCHEMAS.macros.shape;

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
    } else if (!AUTHORED_FIELD_SCHEMAS.name.safeParse(draft.name).success) {
        fieldErrors['name'] = 'out_of_range';
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

        // ⛔ HERE, not after the loop. Asking the whole object once is what let a blank sibling field
        // suppress this verdict entirely; the sub-schema is the SAME declaration, so the bounds still
        // have one authority.
        if (!AUTHORED_MACRO_SCHEMAS[field].safeParse(value).success) {
            fieldErrors[field] = 'out_of_range';
            continue;
        }

        macros[field] = value;
    }

    if (Object.keys(fieldErrors).length > 0) {
        return { ok: false, fieldErrors };
    }

    // Every field has already been parsed against its own bound, so this cannot fail on one of THEM.
    // What it still does is produce the typed request — always its primary job — and refuse anything the
    // OBJECT decides that no single field could.
    //
    // ⚠️ THAT SECOND JOB IS NOT REACHABLE TODAY, AND ITS REPORT WOULD BE WRONG IF IT WERE. There is no
    // cross-field rule on this schema, and the object is built from two literal keys so `strictObject`
    // has no unknown key to find. If one is ever added, zod 4 keeps `.shape` through `.refine()`, so the
    // per-field pass above will silently skip it and land HERE — with an issue path of `['macros']`,
    // which the loop below cannot attribute to a field, so the fallback would blame `name`. The error
    // vocabulary has no inhabitant for "the object as a whole was refused"; adding one means a new
    // `AuthoredFoodFieldErrors` sibling plus localized copy on both leaves. ⛔ Whoever adds the first
    // cross-field rule owes that, and this comment is the notice: the guard holds, its REPORT does not.
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
