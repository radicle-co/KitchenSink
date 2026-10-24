/**
 * @module authoredFoodCreate — the U16 create-your-own-food form's PURE half: the draft shape, its
 * validation, and the sub-state machine the platform leaves render.
 *
 * DESIGN PATTERN: the headless-hook seam's model file (CP-6/P2) — no DOM, no React Native, no TanStack.
 * `useAuthoredFoodCreate` drives the transitions; each leaf renders {@link AuthoredFoodCreateState} with an exhaustive
 * switch.
 *
 * ## Validation is PURE and runs before any request leaves
 *
 * The bounds are the FOOD SERVICE's own: the request is food's `POST /api/v1/foods/authored` body, read from
 * `@kitchensink/schema-food` (ADR-0014: a client takes a service's wire types from that service's schema package).
 * Field errors are KEYS, not sentences: each platform maps them onto its own localized copy, so the model stays
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
import { createAuthoredFoodRequestSchema, type CreateAuthoredFoodRequest } from '@kitchensink/schema-food';

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
const AUTHORED_FIELD_SCHEMAS = createAuthoredFoodRequestSchema.shape;

/** The per-100g macro bounds, per field — the food service's own `authoredMacrosSchema` members. */
const AUTHORED_MACRO_SCHEMAS = AUTHORED_FIELD_SCHEMAS.macros.shape;

/**
 * The name field's own verdict: present, and within the published bound. Pure.
 *
 * @param name - The name field's text.
 * @returns Its error key, or `undefined` when it passes.
 */
const nameFieldError = (name: string): AuthoredFoodFieldError | undefined => {
    if (name.trim().length === 0) {
        return 'required';
    }

    return AUTHORED_FIELD_SCHEMAS.name.safeParse(name).success ? undefined : 'out_of_range';
};

/**
 * One macro field's own verdict: present, a number, and within ITS published bound. Pure.
 *
 * ⛔ The bound is asked here, per field, not once over the whole object: asking the object once is what let a blank
 * sibling field suppress this verdict entirely. The sub-schema is the SAME declaration, so the bounds still have one
 * authority.
 *
 * @param field - The macro field.
 * @param text - Its text.
 * @returns The parsed value, or its error key.
 */
const macroFieldVerdict = (
    field: (typeof AUTHORED_MACRO_FIELDS)[number],
    text: string,
): { readonly value: number } | { readonly error: AuthoredFoodFieldError } => {
    const trimmed = text.trim();

    if (trimmed.length === 0) {
        return { error: 'required' };
    }

    const value = Number(trimmed);

    if (!Number.isFinite(value)) {
        return { error: 'not_a_number' };
    }

    return AUTHORED_MACRO_SCHEMAS[field].safeParse(value).success ? { value } : { error: 'out_of_range' };
};

/**
 * The field errors a refused whole-object parse names: each issue on the field its path heads, and `name` when no
 * issue names a field. Pure.
 *
 * @param issues - The parse's issues.
 * @returns The per-field error keys.
 */
const objectIssueErrors = (issues: readonly { readonly path: readonly PropertyKey[] }[]): AuthoredFoodFieldErrors => {
    const fieldErrors: Record<string, AuthoredFoodFieldError> = Object.create(null) as Record<
        string,
        AuthoredFoodFieldError
    >;

    for (const issue of issues) {
        const head = issue.path[0] === 'macros' ? issue.path[1] : issue.path[0];

        if (typeof head === 'string') {
            fieldErrors[head] = 'out_of_range';
        }
    }

    return Object.keys(fieldErrors).length > 0 ? fieldErrors : { name: 'out_of_range' };
};

/**
 * Validate a draft against the published bounds.
 *
 * @param draft - The form text.
 * @returns The parsed request, or the per-field error keys. Pure.
 */
export function validateAuthoredFoodDraft(
    draft: AuthoredFoodDraft,
):
    | { readonly ok: true; readonly value: CreateAuthoredFoodRequest }
    | { readonly ok: false; readonly fieldErrors: AuthoredFoodFieldErrors } {
    const fieldErrors: Record<string, AuthoredFoodFieldError> = Object.create(null) as Record<
        string,
        AuthoredFoodFieldError
    >;
    const macros: Record<string, number> = Object.create(null) as Record<string, number>;

    const nameError = nameFieldError(draft.name);

    if (nameError !== undefined) {
        fieldErrors['name'] = nameError;
    }

    for (const field of AUTHORED_MACRO_FIELDS) {
        const verdict = macroFieldVerdict(field, draft[field]);

        if ('error' in verdict) {
            fieldErrors[field] = verdict.error;
        } else {
            macros[field] = verdict.value;
        }
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
    const parsed = createAuthoredFoodRequestSchema.safeParse({
        name: draft.name,
        macros,
    });

    if (!parsed.success) {
        return { ok: false, fieldErrors: objectIssueErrors(parsed.error.issues) };
    }

    return { ok: true, value: parsed.data };
}

/**
 * The create-food sub-state a leaf renders. Orthogonal to the entry's `EntrySearchView` on purpose: the form rides
 * over every search state, and folding it into that union would multiply every kind by open/closed.
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

/**
 * The form's own phase: what the cook has done to it. `null` is closed. Whether a request is in flight is the request's
 * fact, never stored here, so {@link authoredFoodCreateStateOf} derives `submitting` and `reusePending` from it.
 */
export type AuthoredFoodCreatePhase =
    | null
    | {
          readonly kind: 'open';
          readonly draft: AuthoredFoodDraft;
          readonly fieldErrors: AuthoredFoodFieldErrors;
          readonly submitFailed: boolean;
      }
    | {
          readonly kind: 'duplicate';
          readonly draft: AuthoredFoodDraft;
          readonly existingFoodId: string;
          readonly reuseFailed: boolean;
      };

/** The requests in flight a state is derived with. */
export interface AuthoredFoodCreateInFlight {
    /** The create, or the work that puts the created food on the line, is running. */
    readonly submitting: boolean;
    /** The reuse of an existing food is running. */
    readonly reusePending: boolean;
}

/**
 * The state a leaf renders, from the phase and what is in flight. Pure.
 *
 * @param phase - The form's phase.
 * @param inFlight - The requests running now.
 * @returns The state.
 */
export function authoredFoodCreateStateOf(
    phase: AuthoredFoodCreatePhase,
    inFlight: AuthoredFoodCreateInFlight,
): AuthoredFoodCreateState {
    if (phase === null) {
        return { kind: 'closed' };
    }

    if (phase.kind === 'open') {
        return inFlight.submitting
            ? { kind: 'submitting', draft: phase.draft }
            : { kind: 'open', draft: phase.draft, fieldErrors: phase.fieldErrors, submitFailed: phase.submitFailed };
    }

    return {
        kind: 'duplicate',
        draft: phase.draft,
        existingFoodId: phase.existingFoodId,
        reusePending: inFlight.reusePending,
        reuseFailed: phase.reuseFailed,
    };
}

/**
 * The open form with one field set: that field's error goes, and so does a failed submit, because the cook is acting on
 * it. Any other phase is returned as it is. Pure.
 *
 * @param phase - The form's phase.
 * @param field - The field the cook edited.
 * @param value - Its new text.
 * @returns The next phase.
 */
export function withAuthoredFoodField(
    phase: AuthoredFoodCreatePhase,
    field: keyof AuthoredFoodDraft,
    value: string,
): AuthoredFoodCreatePhase {
    if (phase === null || phase.kind !== 'open') {
        return phase;
    }

    const { [field]: _cleared, ...rest } = phase.fieldErrors;

    return { ...phase, draft: { ...phase.draft, [field]: value }, fieldErrors: rest, submitFailed: false };
}
