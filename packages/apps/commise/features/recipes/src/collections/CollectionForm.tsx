/**
 * @module @commise/features-recipes — web collection form (T073 building block).
 *
 * Controlled, presentational create/rename form: a single name field plus submit/cancel actions. The `name`
 * value and `submitting`/`error` state are owned by the caller; the form reports edits and submit/cancel
 * upward and fetches nothing. `mode` selects the title and submit label; while `submitting`, the field and
 * both actions are disabled to prevent duplicate submissions.
 */
import { Button, buttonSurfaceClass, busyControlProps } from '@commise/ui/button';
import { useMessages } from '@commise/i18n/react';
import type { FC, FormEvent } from 'react';

import { collectionMessages } from './messages.js';
import type { CollectionFormProps } from './model.js';

export const CollectionForm: FC<CollectionFormProps> = ({
    mode,
    name,
    submitting = false,
    error,
    onChange,
    onSubmit,
    onCancel,
}) => {
    const { form } = useMessages(collectionMessages);
    const title = mode === 'create' ? form.createTitle : form.renameTitle;
    const submitLabel = mode === 'create' ? form.createSubmit : form.renameSubmit;
    const hasError = error !== undefined && error.length > 0;

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit();
    };

    return (
        <form
            aria-label={title}
            onSubmit={handleSubmit}
            className="mx-auto flex max-w-md flex-col gap-4 rounded-2xl bg-paper p-6 shadow-sm"
        >
            {/* An `h1`: this form's title IS the page title of `/collections/new` and
                `/collections/[id]/rename`. It was an `h2` only because the app shell's top bar used to render
                a (hard-coded "Home") `h1` above every route; now that the shell's title is plain banner text,
                the page owns its single `h1`. Tailwind's preflight resets heading font-size/weight/margin, so
                with the same utility classes this is purely semantic — zero pixels change. */}
            <h1 className="font-display text-heading-lg font-semibold text-ink">{title}</h1>
            <label className="flex flex-col gap-1">
                <span className="text-body-sm font-medium text-ink-muted">{form.nameLabel}</span>
                <input
                    type="text"
                    value={name}
                    placeholder={form.namePlaceholder}
                    // Read-only, not disabled: a cook who pressed Enter here is holding focus in this field.
                    readOnly={submitting}
                    onChange={(event) => onChange(event.target.value)}
                    className="w-full rounded-lg border border-line-divider bg-paper px-3 py-2 text-body-md text-ink outline-none focus:ring-2 focus:ring-focus-ring read-only:opacity-60"
                />
            </label>
            {hasError && (
                <p role="alert" className="text-body-sm text-danger-text">
                    {error}
                </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
                {/* The control just pressed goes busy, so it keeps focus; cancelling its click is also what stops an
                    Enter in the field from submitting twice (the Button's `busy`, via `busyControlProps`). */}
                <Button type="submit" icon="check" busy={submitting}>
                    {submitLabel}
                </Button>
                <button
                    type="button"
                    {...busyControlProps({ busy: submitting, onClick: onCancel })}
                    className={buttonSurfaceClass('ghost')}
                >
                    {form.cancel}
                </button>
            </div>
        </form>
    );
};
