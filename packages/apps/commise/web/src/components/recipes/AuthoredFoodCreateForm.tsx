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
 *  - `submitting` — the same fields, READ-ONLY, with a `role="status"` caption AS CONTENT (the picker's
 *    live-region doctrine: an empty live region is zero-height and silent).
 *  - `duplicate` — ⛔ a DISTINCT sentence + a reuse affordance, never generic validation copy: the cook
 *    already made this food, and the fix is to attach it, not to rename it.
 *
 * ⛔ NO NATIVE `disabled` WHILE A REQUEST IS IN FLIGHT. A real browser drops focus to <body> the moment the
 * focused control becomes disabled — and the focused control is exactly the one the cook just used (the submit
 * button, or a field they pressed Enter in). So busy fields are `readOnly` and busy buttons go through
 * `busyControlProps`/`refusedPressProps`, which refuse the press in the DOM; the hook refuses too (WCAG 2.2 SC
 * 2.4.3). jsdom does not reproduce the drop, which is why the component tests assert the attributes and the
 * refusal rather than focus alone.
 *
 * @pattern Humble Object over the shared `createFood` sub-machine — it renders the state and decides nothing.
 *     Its one imperative seam moves focus onto the duplicate branch's reuse control, and only when focus has
 *     nowhere else to be.
 */
import type { IngredientCreateFoodMessages } from '@commise/features-recipes';
import { fillTemplate } from '@commise/features-recipes';
import type {
    AuthoredFoodCreateState,
    AuthoredFoodDraft,
    AuthoredFoodFieldError,
} from '@commise/features-recipes/hooks';
import { BUSY_CONTROL_CLASS, busyControlProps, refusedPressProps } from '@commise/ui/button';
import { focusIfLost } from '@commise/ui/dialog-focus';
import { useEffect, useRef, type FC, type JSX } from 'react';

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
    /** The id the trigger's `aria-controls` names — whichever branch is showing carries it. */
    readonly id: string;
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

/**
 * The per-author collision: a DISTINCT sentence and a reuse affordance.
 *
 * ⛔ Takes focus ONLY when nothing else holds it. This branch replaces the form when a network response lands,
 * so the control the cook last used is gone and focus is on <body> — unless they have already moved on (typing
 * in the search box, say), in which case moving focus would corrupt what they are typing. The `role="status"`
 * notice announces the collision either way. Runs once, on mount: a re-render (the reuse going pending) must
 * never pull focus back.
 */
const DuplicateBranch: FC<{
    readonly id: string;
    readonly state: Extract<AuthoredFoodCreateFormProps['state'], { kind: 'duplicate' }>;
    readonly copy: IngredientCreateFoodMessages;
    readonly actions: AuthoredFoodCreateFormActions;
}> = ({ id, state, copy, actions }): JSX.Element => {
    const reuseRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        focusIfLost(reuseRef.current);
    }, []);

    return (
        <div id={id} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-sm">
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
                    ref={reuseRef}
                    type="button"
                    {...busyControlProps({ busy: state.reusePending, onClick: actions.reuseExisting })}
                    className={`rounded-full bg-seafoam px-4 py-1.5 text-body-sm font-semibold text-white shadow-sm transition hover:bg-ocean-dark ${BUSY_CONTROL_CLASS}`}
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
};

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

export const AuthoredFoodCreateForm: FC<AuthoredFoodCreateFormProps> = ({ state, copy, actions, id }): JSX.Element => {
    if (state.kind === 'duplicate') {
        return <DuplicateBranch id={id} state={state} copy={copy} actions={actions} />;
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
                        // The form opens below the whole results card, so tab order cannot carry a keyboard user
                        // to it; the first field takes focus as the form MOUNTS — once, never on a re-render
                        // (an invalid submit leaves focus where the cook put it). WCAG 2.2 SC 2.4.3.
                        autoFocus={name === 'name'}
                        inputMode={inputMode}
                        value={state.draft[name]}
                        onChange={(event) => actions.setField(name, event.target.value)}
                        readOnly={submitting}
                        aria-invalid={error !== undefined}
                        aria-describedby={error === undefined ? undefined : errorId}
                        className="rounded-lg border border-border bg-card px-3 py-1.5 text-body-sm text-ink outline-none transition focus:border-seafoam read-only:opacity-60"
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
            id={id}
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
                    {...busyControlProps({ busy: submitting })}
                    className={`rounded-full bg-seafoam px-4 py-1.5 text-body-sm font-semibold text-white shadow-sm transition hover:bg-ocean-dark ${BUSY_CONTROL_CLASS}`}
                >
                    {copy.submit}
                </button>
                <button
                    type="button"
                    // Refused in the DOM while the create is in flight, so the picker's cancel wrapper — which moves
                    // focus to the trigger before closing — never runs for a close that cannot happen.
                    {...refusedPressProps({ unavailable: submitting, onClick: actions.cancel })}
                    className={`rounded-full bg-seafoam/10 px-4 py-1.5 text-body-sm font-medium text-ocean-dark transition hover:bg-seafoam/20 ${BUSY_CONTROL_CLASS}`}
                >
                    {copy.cancel}
                </button>
            </div>
        </form>
    );
};
