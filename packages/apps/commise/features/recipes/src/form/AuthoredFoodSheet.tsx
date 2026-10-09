'use client';

/**
 * @module @commise/features-recipes/form — the create-my-own-food form on the design-system `Sheet`, web
 * (`docs/design/rowEditorOpenDecisions.md` item 1; `docs/design/rowEditorBlueprint.md` decision 2). A Radix dialog,
 * full screen below 640 px, which the row's `⋮ → Create my own food` opens.
 *
 * A presentational leaf: it renders `useAuthoredFoodCreate`'s state, which the field group passes in, and reports every
 * action. Its states are the authoring form's own (`docs/design/ingredientStatusExplanation.md` §4): open, a field
 * error, a failed submit (`statusAuthorFailed`, the draft kept), submitting, the duplicate and its reuse.
 *
 * - Focus goes to the name field on open: it focuses itself on mount, so the Sheet leaves it there. In the duplicate
 *   state, Use that one takes focus as it replaces the form: inside the modal sheet, focus has nowhere else to be.
 * - ⛔ No native `disabled` while a request is in flight: a browser drops focus from a control that turns disabled
 *   (WCAG 2.2 SC 2.4.3), so busy and refused controls go through `busyControlProps` and `refusedPressProps`.
 *
 * @pattern Adapter over the design-system `Sheet` — the form's states mapped to the sheet's slots
 */
import { useMessages } from '@commise/i18n/react';
import {
    Button,
    BUSY_CONTROL_CLASS,
    busyControlProps,
    buttonSurfaceClass,
    refusedPressProps,
} from '@commise/ui/button';
import { Sheet } from '@commise/ui/sheet';
import { Icon } from '@commise/ui/icon';
import { useId, type FC, type JSX } from 'react';

import type { AuthoredFoodDraft } from '../hooks/authoredFoodCreate.model.js';
import { useLastDefined } from '../hooks/useLastDefined.js';
import { fillTemplate } from '../list/model.js';
import { recipeMessages } from '../messages.js';
import {
    authoredFieldErrorText,
    authoredMacroFields,
    type AuthoredFoodSheetProps,
    type OpenAuthoredFoodState,
} from './authoredFoodSheet.model.js';
import { recipeFormMessages } from './messages.js';

const INPUT =
    'w-full rounded-lg border border-line-control bg-paper px-3 py-2 text-body-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-focus-ring read-only:opacity-60 aria-[invalid=true]:border-error-dark';

/** The form, the sheet's content while open. */
const FormBody: FC<{
    readonly state: Extract<OpenAuthoredFoodState, { kind: 'open' | 'submitting' }>;
    readonly props: AuthoredFoodSheetProps;
}> = ({ state, props }) => {
    const { ingredientCreateFood: copy } = useMessages(recipeMessages);
    const { statusAuthorFailed } = useMessages(recipeFormMessages);
    const idPrefix = useId();
    const submitting = state.kind === 'submitting';
    const fieldErrors = state.kind === 'open' ? state.fieldErrors : {};

    const field = (name: keyof AuthoredFoodDraft, label: string, inputMode: 'text' | 'decimal'): JSX.Element => {
        const error = fieldErrors[name];
        const errorId = `${idPrefix}-${name}-error`;

        return (
            <div key={name} className="flex flex-col gap-1">
                <label className="flex flex-col gap-1 text-body-sm text-ink-muted">
                    {label}
                    <input
                        type="text"
                        // Focus to the name field on open (item 1), once: a re-render never pulls focus back.
                        autoFocus={name === 'name'}
                        inputMode={inputMode}
                        value={state.draft[name]}
                        onChange={(event) => props.onFieldChange(name, event.target.value)}
                        readOnly={submitting}
                        aria-invalid={error !== undefined || undefined}
                        aria-describedby={error === undefined ? undefined : errorId}
                        className={INPUT}
                    />
                </label>
                {error !== undefined && (
                    <p id={errorId} className="text-caption text-danger-text">
                        {authoredFieldErrorText(copy, error)}
                    </p>
                )}
            </div>
        );
    };

    return (
        <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
                event.preventDefault();

                if (!submitting) {
                    props.onSubmit();
                }
            }}
        >
            {field('name', copy.nameLabel, 'text')}
            <fieldset className="flex flex-col gap-2">
                <legend className="text-caption font-semibold text-ink-muted">{copy.per100gHint}</legend>
                <div className="grid grid-cols-2 gap-2">
                    {authoredMacroFields(copy).map(({ field: name, label }) => field(name, label, 'decimal'))}
                </div>
            </fieldset>
            {/* The one line telling the cook this is theirs alone until promotion (D9a/U11). */}
            <p className="text-caption text-ink-muted">{copy.privateHint}</p>
            {submitting && (
                <p role="status" className="text-body-sm text-ink-muted">
                    {copy.submitting}
                </p>
            )}
            {state.kind === 'open' && state.submitFailed && (
                <p role="alert" className="text-body-sm text-danger-text">
                    {statusAuthorFailed}
                </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" icon="check" busy={submitting}>
                    {copy.submit}
                </Button>
                <button
                    type="button"
                    {...refusedPressProps({ unavailable: submitting, onClick: props.onCancel })}
                    className={`${buttonSurfaceClass('secondary')} ${BUSY_CONTROL_CLASS}`}
                >
                    <Icon name="x" size={20} />
                    {copy.cancel}
                </button>
            </div>
        </form>
    );
};

/** The per-author collision: its own sentence, and the reuse of the food the cook already made. */
const DuplicateBody: FC<{
    readonly state: Extract<OpenAuthoredFoodState, { kind: 'duplicate' }>;
    readonly props: AuthoredFoodSheetProps;
}> = ({ state, props }) => {
    const { ingredientCreateFood: copy } = useMessages(recipeMessages);

    return (
        <div className="flex flex-col gap-3">
            <p role="status" className="text-body-sm text-ink">
                {fillTemplate(copy.duplicateNotice, { name: state.draft.name })}
            </p>
            {state.reuseFailed && (
                <p role="alert" className="text-body-sm text-danger-text">
                    {copy.duplicateReuseFailed}
                </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    autoFocus
                    {...busyControlProps({ busy: state.reusePending, onClick: props.onReuse })}
                    className={`${buttonSurfaceClass('primary')} ${BUSY_CONTROL_CLASS}`}
                >
                    <Icon name="check" size={20} />
                    {copy.duplicateReuse}
                </button>
                <button
                    type="button"
                    {...refusedPressProps({ unavailable: state.reusePending, onClick: props.onCancel })}
                    className={`${buttonSurfaceClass('secondary')} ${BUSY_CONTROL_CLASS}`}
                >
                    <Icon name="x" size={20} />
                    {copy.cancel}
                </button>
            </div>
        </div>
    );
};

/** The authored-food Sheet. */
export const AuthoredFoodSheet: FC<AuthoredFoodSheetProps> = (props) => {
    const { state } = props;
    const { ingredientCreateFood: copy } = useMessages(recipeMessages);
    const content = useLastDefined<OpenAuthoredFoodState>(state.kind === 'closed' ? undefined : state);

    return (
        <Sheet
            open={state.kind !== 'closed'}
            onOpenChange={(open) => {
                if (!open) {
                    props.onCancel();
                }
            }}
            onDismissed={props.onDismissed}
            title={content === undefined ? '' : fillTemplate(copy.formTitle, { query: content.draft.name })}
            closeLabel={copy.close}
            size="content"
        >
            {content === undefined ? null : content.kind === 'duplicate' ? (
                <DuplicateBody state={content} props={props} />
            ) : (
                <FormBody state={content} props={props} />
            )}
        </Sheet>
    );
};
