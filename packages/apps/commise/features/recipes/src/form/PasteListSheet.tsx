'use client';

/**
 * @module @commise/features-recipes/form — `PasteListSheet` (web): the Paste a list sheet (build spec §7.5.4) in the
 * Ingredients section. A labelled field in Inter, a live line count, the refusals before any round trip, and the primary
 * "Add {n} ingredients", disabled at 0 and busy while the parse job is created. A send that did not take is said as an
 * alert and keeps the text. Its state is `usePasteListSheet`'s; what it sends to is `usePasteIntoIngredients`.
 *
 * Presentational: props in, markup out. The native leaf is `./PasteListSheet.native.tsx`.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { FieldLabel, TextArea, fieldHintId } from '@commise/ui/input';
import { Sheet } from '@commise/ui/sheet';
import type { FC } from 'react';

import { editorMessages, pluralOf } from '../editor/messages.js';
import type { PasteListSheetProps } from './pasteListSheetProps.js';
import { pasteListFieldId } from './fieldIds.js';
import { recipeFormMessages } from './messages.js';

/** The Paste a list sheet. */
export const PasteListSheet: FC<PasteListSheetProps> = ({ sheet, submitting, failed }) => {
    const { ingredients: t } = useMessages(editorMessages);
    const m = useMessages(recipeFormMessages);
    const locale = useLocale();
    const { lineCount, refusals, canSubmit } = sheet.model;

    return (
        <Sheet
            open={sheet.open}
            onOpenChange={sheet.setOpen}
            title={t.pasteTitle}
            closeLabel={m.pasteListClose}
            size="content"
            footer={
                <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="ghost" onPress={() => sheet.setOpen(false)}>
                        {t.pasteCancel}
                    </Button>
                    <Button icon="plus" disabled={!canSubmit} busy={submitting} onPress={sheet.add}>
                        {pluralOf(t.pasteAdd, lineCount, locale)}
                    </Button>
                </div>
            }
        >
            <div className="flex flex-col gap-1">
                <FieldLabel forId={pasteListFieldId} label={t.pasteLabel} hint={t.pasteHint} />
                {/* §7.5.4: ten rows at least, 72ch at most. */}
                <div className="max-w-[72ch]">
                    <TextArea
                        id={pasteListFieldId}
                        value={sheet.text}
                        minRows={10}
                        describedBy={fieldHintId(pasteListFieldId)}
                        onChangeText={sheet.setText}
                    />
                </div>
                <p className="text-body-sm font-semibold tabular-nums text-ink-muted">
                    {pluralOf(t.pasteCount, lineCount, locale)}
                </p>
                {refusals.map((refusal) => (
                    <p key={refusal} className="text-meta text-danger-text">
                        {refusal}
                    </p>
                ))}
                <p role="alert" className="text-meta text-danger-text empty:hidden">
                    {failed ? t.pasteFailed : ''}
                </p>
            </div>
        </Sheet>
    );
};
