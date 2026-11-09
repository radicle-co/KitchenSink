'use client';

/**
 * @module @commise/features-recipes/foodPage — `FoodEditSheet` (web): the edit form of the cook's own food, on the design-system
 * `Sheet` (private foods spec section 6, states 13 and 14). The fields, limits and errors are the create form's own
 * (`ingredientCreateFood`); what differs is the title, the submit ("Save", or "Send for review" for a public food, whose
 * edit goes to staff while readers keep the approved version), and the notice above the form.
 *
 * Presentational: `props → JSX` over `useFoodEdit`'s session. Fields are labels wrapping inputs, like the create sheet.
 *
 * @pattern Adapter over the design-system `Sheet` — the form's session mapped to the sheet's slots
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { FOCUS_RING_CLASS } from '@commise/ui/focus-ring';
import { Sheet } from '@commise/ui/sheet';
import { useId, type FC } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import type { AuthoredFoodDraft } from '../hooks/authoredFoodCreate.model.js';
import { authoredFieldErrorText, authoredMacroFields } from '../form/authoredFoodSheet.model.js';
import { recipeMessages } from '../messages.js';
import { foodPageMessages } from './messages.js';
import type { FoodEditSession } from './useFoodEdit.js';

const INPUT = `w-full rounded-lg border border-line-control bg-paper px-3 py-2 text-body-sm text-ink ${FOCUS_RING_CLASS.offset} read-only:opacity-60 aria-[invalid=true]:border-danger`;

/** The edit sheet. */
export const FoodEditSheet: FC<{ readonly session: FoodEditSession }> = ({ session }) => {
    const { edit: m } = useMessages(foodPageMessages);
    const { ingredientCreateFood: copy } = useMessages(recipeMessages);
    const idPrefix = useId();
    const { draft, fieldErrors, submitting } = session;
    const noChange = session.sendsForReview ? m.noChangeSend : m.noChangeSave;
    const notice = session.notice === null ? undefined : m.notice[session.notice];
    // A public food with an edit already waiting says both lines: it is reviewed, and this replaces the other.
    const replaces = session.notice === 'replacesWaiting' ? m.notice.review : undefined;

    const field = (name: keyof AuthoredFoodDraft, label: string, inputMode: 'text' | 'decimal') => {
        const error = fieldErrors[name];
        const errorId = `${idPrefix}-${name}-error`;

        return (
            <div key={name} className="flex flex-col gap-1">
                <label className="flex flex-col gap-1 text-body-sm text-ink-muted">
                    {label}
                    <input
                        type="text"
                        autoFocus={name === 'name'}
                        inputMode={inputMode}
                        value={draft[name]}
                        onChange={(event) => session.onChange(name, event.target.value)}
                        readOnly={submitting}
                        aria-invalid={error !== undefined || undefined}
                        aria-describedby={error === undefined ? undefined : errorId}
                        className={INPUT}
                    />
                </label>
                {error === undefined ? null : (
                    <p id={errorId} className="text-caption text-danger-text">
                        {authoredFieldErrorText(copy, error)}
                    </p>
                )}
            </div>
        );
    };

    return (
        <Sheet
            open={session.open}
            onOpenChange={(next) => {
                if (!next) {
                    session.onCancel();
                }
            }}
            title={fillTemplate(m.title, { name: session.name })}
            closeLabel={m.close}
            size="content"
        >
            <form
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                    event.preventDefault();
                    session.onSubmit();
                }}
            >
                {replaces === undefined ? null : <p className="text-caption text-ink-muted">{replaces}</p>}
                {notice === undefined ? null : <p className="text-caption text-ink-muted">{notice}</p>}
                {field('name', copy.nameLabel, 'text')}
                <fieldset className="flex flex-col gap-2">
                    <legend className="text-caption font-semibold text-ink-muted">{copy.per100gHint}</legend>
                    <div className="grid grid-cols-2 gap-2">
                        {authoredMacroFields(copy).map(({ field: name, label }) => field(name, label, 'decimal'))}
                    </div>
                </fieldset>
                {session.failed ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {m.failed}
                    </p>
                ) : null}
                {session.duplicate ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {m.duplicate}
                    </p>
                ) : null}
                <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            type="submit"
                            icon="check"
                            busy={submitting}
                            refused={session.unchanged}
                            {...(session.unchanged ? { description: noChange } : {})}
                        >
                            {submitting
                                ? session.sendsForReview
                                    ? m.sending
                                    : m.saving
                                : session.sendsForReview
                                  ? m.send
                                  : m.save}
                        </Button>
                        <Button variant="secondary" onPress={session.onCancel}>
                            {m.cancel}
                        </Button>
                    </div>
                    {session.unchanged ? (
                        <p aria-hidden className="text-caption text-ink-muted">
                            {noChange}
                        </p>
                    ) : null}
                </div>
            </form>
        </Sheet>
    );
};
