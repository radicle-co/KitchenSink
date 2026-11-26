/**
 * @module @commise/features-recipes/form — `RecipeSourceField` (web): the Source row in Photos & publish (ADR-0089), the web
 * page a recipe was copied from. A presentational render of the row's state (`sourceRowOf`): the editor's session owns the text, the
 * paste's caption and the focus request, and this leaf holds none.
 *
 * A single-line URL field under its label, with the hint or status under it (the hint when empty, "Copied from a public web
 * page · {site}" when filled) and a "Remove source" text button once there is text. A locked source
 * (ADR-0023 section 1b): the site is then a link that opens in a new tab, with the address and the reason, and no field.
 * The status, the paste's caption and the error are all named by the field's `aria-describedby`.
 *
 * The native leaf is `./RecipeSourceField.native.tsx`.
 *
 * @pattern Visitor — an exhaustive switch over the discriminated union `SourceRowModel`
 */
import { fillTemplate } from '@commise/i18n';
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { FieldLabel, Input, fieldHintId } from '@commise/ui/input';
import { SOURCE_LINK_INPUT_MAX_LENGTH } from '@kitchensink/recipe-core';
import type { FC, ReactNode } from 'react';

import { recipeActionMessages } from '../actions/messages.js';
import { editorMessages } from '../editor/messages.js';
import { sourceErrorId, sourceNoteId, sourceWarningId } from './fieldErrorIds.js';
import { describedByOf, sourceFieldId } from './fieldIds.js';
import { lockedAnswerLabel } from './sourceLink.js';
import type { RecipeSourceFieldProps } from './sourceFieldProps.js';

/** The Source row. */
export const RecipeSourceField: FC<RecipeSourceFieldProps> = ({
    row,
    onChange,
    onRemove,
    onTouched,
    onAsk,
    askHref,
}) => {
    const { source: m } = useMessages(editorMessages);
    const { sourceStatement: answers } = useMessages(recipeActionMessages);

    if (row.kind === 'hidden') {
        return null;
    }

    // The help link of a locked row, and of "I wrote this" (its own words): a text link, left-aligned, never a button.
    const helpLink = (text: string): ReactNode =>
        askHref === undefined ? null : (
            <a
                href={askHref}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-11 min-w-0 self-start py-2 text-body-sm font-medium text-action-text underline underline-offset-2"
            >
                {text}
            </a>
        );

    if (row.kind === 'own') {
        return (
            <div className="flex flex-col gap-1">
                <span className="text-label text-ink-muted">{m.label}</span>
                <span className="text-body-sm font-medium text-ink">{answers.answerAuthored}</span>
                <div>
                    <Button variant="ghost" onPress={() => onAsk('downgrade')}>
                        {m.changeOwn}
                    </Button>
                </div>
                {helpLink(m.askOtherWeb)}
            </div>
        );
    }

    if (row.kind === 'openAnswered') {
        return (
            <div className="flex flex-col gap-1">
                <span className="text-label text-ink-muted">{m.label}</span>
                <span className="text-body-sm font-medium text-ink">{lockedAnswerLabel(row.answer, answers)}</span>
                {row.citation === '' ? null : (
                    <span className="min-w-0 break-words text-caption text-ink-muted">{row.citation}</span>
                )}
                <p className="text-caption text-ink-muted">{m.lockWarning}</p>
                <div>
                    <Button variant="ghost" onPress={() => onAsk('change')}>
                        {m.changeAnswer}
                    </Button>
                </div>
            </div>
        );
    }

    if (row.kind === 'locked') {
        return (
            <div className="flex flex-col gap-1">
                <span className="text-label text-ink-muted">{m.label}</span>
                <a
                    href={row.url}
                    target="_blank"
                    // The address is the cook's own and was proved a web link, but it is still another site's page.
                    rel="noopener noreferrer nofollow ugc"
                    className="min-w-0 break-all text-body-sm font-medium text-action-text underline underline-offset-2"
                >
                    {fillTemplate(m.openLinkWeb, { site: row.site })}
                </a>
                <span className="min-w-0 break-all text-caption text-ink-muted">{row.url}</span>
                <p className="text-caption text-ink-muted">{m.locked}</p>
                {helpLink(m.askChangeWeb)}
            </div>
        );
    }

    if (row.kind === 'lockedAnswer') {
        return (
            <div className="flex flex-col gap-1">
                <span className="text-label text-ink-muted">{m.label}</span>
                {row.answer === undefined ? null : (
                    <span className="text-body-sm font-medium text-ink">{lockedAnswerLabel(row.answer, answers)}</span>
                )}
                {row.citation === undefined || row.citation === '' ? null : (
                    <span className="min-w-0 break-words text-caption text-ink-muted">{row.citation}</span>
                )}
                <p className="text-caption text-ink-muted">{m.locked}</p>
                {helpLink(m.askChangeWeb)}
            </div>
        );
    }

    // empty, filled, invalid or a Commise link: the field.
    const error = row.kind === 'invalid' ? m.invalid : row.kind === 'ownSite' ? m.ownSite : undefined;
    const status = row.kind === 'filled' ? fillTemplate(m.rightsLabel, { site: row.site }) : m.hint;
    const pasted = row.kind === 'filled' && row.fromPaste;
    // Only a filled link is something the lock will hold: the warning says when (publish, or the next save once confirmed).
    const warning = row.kind === 'filled' ? (row.confirmed === true ? m.lockWarningSave : m.lockWarning) : undefined;

    return (
        // Leaving the field is the cook being done typing: the blur bubbles to here, so the leaf needs no ref.
        <div className="flex flex-col gap-1" onBlur={onTouched}>
            <FieldLabel forId={sourceFieldId} label={m.label} hint={status} />
            <Input
                id={sourceFieldId}
                value={row.text}
                inputMode="url"
                maxLength={SOURCE_LINK_INPUT_MAX_LENGTH}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                invalid={error !== undefined}
                describedBy={describedByOf(
                    fieldHintId(sourceFieldId),
                    pasted ? sourceNoteId : undefined,
                    warning === undefined ? undefined : sourceWarningId,
                    error === undefined ? undefined : sourceErrorId,
                )}
                onChangeText={onChange}
                onSubmit={onTouched}
            />
            {pasted ? (
                <p id={sourceNoteId} className="text-caption text-ink-muted">
                    {m.fromPaste}
                </p>
            ) : null}
            {warning === undefined ? null : (
                <p id={sourceWarningId} className="text-caption text-ink-muted">
                    {warning}
                </p>
            )}
            {error === undefined ? null : (
                <p id={sourceErrorId} className="text-caption text-danger-text">
                    {error}
                </p>
            )}
            {row.text === '' ? null : (
                <div>
                    <Button variant="ghost" onPress={onRemove}>
                        {m.remove}
                    </Button>
                </div>
            )}
            <div>
                <Button variant="ghost" onPress={() => onAsk('firstAnswer')}>
                    {m.sayWhere}
                </Button>
            </div>
        </div>
    );
};
