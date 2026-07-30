/**
 * @module @commise/features-recipes — web collection form (T073 building block).
 *
 * Controlled, presentational create/rename form: a single name field plus submit/cancel actions. The `name`
 * value and `submitting`/`error` state are owned by the caller; the form reports edits and submit/cancel
 * upward and fetches nothing. `mode` selects the title and submit label; while `submitting`, the field and
 * both actions are disabled to prevent duplicate submissions.
 */
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
            className="mx-auto flex max-w-md flex-col gap-4 rounded-2xl bg-card p-6 shadow-sm"
        >
            {/* An `h1`: this form's title IS the page title of `/collections/new` and
                `/collections/[id]/rename`. It was an `h2` only because the app shell's top bar used to render
                a (hard-coded "Home") `h1` above every route; now that the shell's title is plain banner text,
                the page owns its single `h1`. Tailwind's preflight resets heading font-size/weight/margin, so
                with the same utility classes this is purely semantic — zero pixels change. */}
            <h1 className="font-display text-heading-lg font-semibold text-charcoal">{title}</h1>
            <label className="flex flex-col gap-1">
                <span className="text-body-sm font-medium text-slate">{form.nameLabel}</span>
                <input
                    type="text"
                    value={name}
                    placeholder={form.namePlaceholder}
                    disabled={submitting}
                    onChange={(event) => onChange(event.target.value)}
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-body-md text-charcoal outline-none focus:ring-2 focus:ring-seafoam disabled:opacity-60"
                />
            </label>
            {hasError && (
                <p role="alert" className="text-body-sm text-error-dark">
                    {error}
                </p>
            )}
            <div className="flex items-center gap-3">
                <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-full bg-seafoam px-6 py-2.5 text-body-sm font-semibold text-white shadow-sm transition hover:bg-ocean-dark disabled:opacity-60"
                >
                    {submitLabel}
                </button>
                <button
                    type="button"
                    disabled={submitting}
                    onClick={onCancel}
                    className="rounded-full px-4 py-2 text-body-sm font-medium text-slate transition hover:bg-pearl disabled:opacity-60"
                >
                    {form.cancel}
                </button>
            </div>
        </form>
    );
};
