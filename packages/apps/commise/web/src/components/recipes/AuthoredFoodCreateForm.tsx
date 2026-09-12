'use client';

/**
 * The U16 create-your-own-food form — the web renderer over the shared `createFood` sub-machine
 * (`useIngredientResolver().createFood`; states in `authoredFoodCreate.model.ts`).
 *
 * A thin PRESENTATIONAL leaf (CP-6/P2): pure `props → JSX`, no fetching, no mutations — every action is
 * the hook's, every string the shared `IngredientCreateFoodMessages` copy, so the two platforms cannot
 * drift on what a duplicate or a failed submit says.
 *
 * Three states, three renders (exhaustive over the non-closed union):
 *  - `open` — the macros-only form (Q3a), inline per-field errors (keys mapped to copy HERE, so the model
 *    stays locale-free), the only-you visibility promise, and the retryable submit-failure alert.
 *  - `submitting` — the same fields, disabled, with a `role="status"` caption AS CONTENT (the picker's
 *    live-region doctrine: an empty live region is zero-height and silent).
 *  - `duplicate` — ⛔ a DISTINCT sentence + a reuse affordance, never generic validation copy: the cook
 *    already made this food, and the fix is to attach it, not to rename it.
 */
import type { IngredientCreateFoodMessages } from '@commise/features-recipes';
import { fillTemplate } from '@commise/features-recipes';
import type {
    AuthoredFoodCreateState,
    AuthoredFoodDraft,
    AuthoredFoodFieldError,
} from '@commise/features-recipes/hooks';
import type { FC, JSX } from 'react';

/** The actions the form wires — the hook's own, passed through untouched. */
export interface AuthoredFoodCreateFormActions {
    readonly cancel: () => void;
    readonly setField: (field: keyof AuthoredFoodDraft, value: string) => void;
    readonly submit: () => void;
    readonly reuseExisting: () => void;
}

export interface AuthoredFoodCreateFormProps {
    /** The sub-machine's state — never `closed` (the picker renders nothing then). */
    readonly state: Exclude<AuthoredFoodCreateState, { kind: 'closed' }>;
    readonly copy: IngredientCreateFoodMessages;
    readonly actions: AuthoredFoodCreateFormActions;
}

/** One field error key, mapped onto its localized sentence. Pure. */
function errorText(copy: IngredientCreateFoodMessages, error: AuthoredFoodFieldError): string {
    switch (error) {
        case 'required':
            return copy.errorRequired;
        case 'not_a_number':
            return copy.errorNotANumber;
        case 'out_of_range':
            return copy.errorOutOfRange;
    }
}

/** The four macro fields, with their localized labels, in the shared stable order. */
function macroFields(
    copy: IngredientCreateFoodMessages,
): ReadonlyArray<{ readonly field: Exclude<keyof AuthoredFoodDraft, 'name'>; readonly label: string }> {
    return [
        { field: 'calories', label: copy.caloriesLabel },
        { field: 'proteinG', label: copy.proteinLabel },
        { field: 'carbsG', label: copy.carbsLabel },
        { field: 'fatG', label: copy.fatLabel },
    ];
}

export const AuthoredFoodCreateForm: FC<AuthoredFoodCreateFormProps> = ({ state, copy, actions }): JSX.Element => {
    if (state.kind === 'duplicate') {
        return (
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-sm">
                <p role="status" className="text-body-sm text-slate">
                    {fillTemplate(copy.duplicateNotice, { name: state.draft.name })}
                </p>
                {state.reuseFailed && (
                    <p role="alert" className="text-body-sm text-error-dark">
                        {copy.duplicateReuseFailed}
                    </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={actions.reuseExisting}
                        disabled={state.reusePending}
                        aria-busy={state.reusePending}
                        className="rounded-full bg-seafoam px-4 py-1.5 text-body-sm font-semibold text-white shadow-sm transition hover:bg-ocean-dark disabled:opacity-60"
                    >
                        {copy.duplicateReuse}
                    </button>
                    <button
                        type="button"
                        onClick={actions.cancel}
                        className="rounded-full bg-seafoam/10 px-4 py-1.5 text-body-sm font-medium text-ocean-dark transition hover:bg-seafoam/20"
                    >
                        {copy.cancel}
                    </button>
                </div>
            </div>
        );
    }

    const submitting = state.kind === 'submitting';
    const fieldErrors = state.kind === 'open' ? state.fieldErrors : {};

    /** One labeled input with its inline error. */
    const field = (name: keyof AuthoredFoodDraft, label: string, inputMode: 'text' | 'decimal'): JSX.Element => {
        const error = fieldErrors[name];
        const errorId = `authored-food-${name}-error`;

        return (
            <div className="flex flex-col gap-1" key={name}>
                <label className="flex flex-col gap-1 text-body-sm text-slate">
                    {label}
                    <input
                        type="text"
                        inputMode={inputMode}
                        value={state.draft[name]}
                        onChange={(event) => actions.setField(name, event.target.value)}
                        disabled={submitting}
                        aria-invalid={error !== undefined}
                        aria-describedby={error === undefined ? undefined : errorId}
                        className="rounded-lg border border-border bg-card px-3 py-1.5 text-body-sm text-ink outline-none transition focus:border-seafoam disabled:opacity-60"
                    />
                </label>
                {error !== undefined && (
                    <p id={errorId} role="alert" className="text-caption text-error-dark">
                        {errorText(copy, error)}
                    </p>
                )}
            </div>
        );
    };

    return (
        <form
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-sm"
            onSubmit={(event) => {
                event.preventDefault();
                actions.submit();
            }}
            aria-label={fillTemplate(copy.formTitle, { query: state.draft.name })}
        >
            <h3 className="text-body-sm font-semibold text-ink">
                {fillTemplate(copy.formTitle, { query: state.draft.name })}
            </h3>

            {field('name', copy.nameLabel, 'text')}

            <fieldset className="flex flex-col gap-2">
                <legend className="text-caption font-semibold uppercase tracking-wide text-slate">
                    {copy.per100gHint}
                </legend>
                <div className="grid grid-cols-2 gap-2">
                    {macroFields(copy).map(({ field: name, label }) => field(name, label, 'decimal'))}
                </div>
            </fieldset>

            {/* D9a/U11: the one line telling the cook this is theirs alone until promotion. */}
            <p className="text-caption text-slate">{copy.privateHint}</p>

            {submitting && (
                <p role="status" className="text-body-sm text-slate">
                    {copy.submitting}
                </p>
            )}

            {state.kind === 'open' && state.submitFailed && (
                <p role="alert" className="text-body-sm text-error-dark">
                    {copy.submitFailed}
                </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="submit"
                    disabled={submitting}
                    aria-busy={submitting}
                    className="rounded-full bg-seafoam px-4 py-1.5 text-body-sm font-semibold text-white shadow-sm transition hover:bg-ocean-dark disabled:opacity-60"
                >
                    {copy.submit}
                </button>
                <button
                    type="button"
                    onClick={actions.cancel}
                    disabled={submitting}
                    className="rounded-full bg-seafoam/10 px-4 py-1.5 text-body-sm font-medium text-ocean-dark transition hover:bg-seafoam/20 disabled:opacity-60"
                >
                    {copy.cancel}
                </button>
            </div>
        </form>
    );
};
