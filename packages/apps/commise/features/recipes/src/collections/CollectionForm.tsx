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
        <form aria-label={title} onSubmit={handleSubmit}>
            <h2>{title}</h2>
            <label>
                {form.nameLabel}
                <input
                    type="text"
                    value={name}
                    placeholder={form.namePlaceholder}
                    disabled={submitting}
                    onChange={(event) => onChange(event.target.value)}
                />
            </label>
            {hasError && <p role="alert">{error}</p>}
            <button type="submit" disabled={submitting}>
                {submitLabel}
            </button>
            <button type="button" disabled={submitting} onClick={onCancel}>
                {form.cancel}
            </button>
        </form>
    );
};
