'use client';

/**
 * @module @commise/features-recipes/form — `PasteStepsControl` (web): "Paste steps" (`docs/design/uiOverhaul/buildSpec.md`
 * §7.6), a ghost button that opens a sheet. The cook pastes into a labelled field, the primary "Add {n} steps" counts
 * the steps as they paste and is disabled at 0, and adding closes the sheet and hands the steps up through `onAdd`.
 * The editor frame places it in the Steps H2 and turns `onAdd` into the draft's `appendSteps`.
 *
 * `'use client'`: the sheet's state (`usePasteSteps`). The native leaf is `./PasteStepsControl.native.tsx`.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { FieldLabel, TextArea, fieldHintId } from '@commise/ui/input';
import { Sheet } from '@commise/ui/sheet';
import type { FC } from 'react';

import { editorMessages, pluralOf } from '../editor/messages.js';
import { pasteStepsFieldId } from './fieldIds.js';
import { recipeFormMessages } from './messages.js';
import { usePasteSteps } from './usePasteSteps.js';

/** Props for {@link PasteStepsControl}. */
export interface PasteStepsControlProps {
    /** Called with the pasted steps, in order, when the cook adds them. */
    readonly onAdd: (instructions: readonly string[]) => void;
}

/** "Paste steps": the button and its sheet. */
export const PasteStepsControl: FC<PasteStepsControlProps> = ({ onAdd }) => {
    const { steps: s } = useMessages(editorMessages);
    const m = useMessages(recipeFormMessages);
    const locale = useLocale();
    const paste = usePasteSteps(onAdd);

    return (
        <>
            <Button variant="ghost" icon="listPlus" onPress={() => paste.setOpen(true)}>
                {s.paste}
            </Button>
            <Sheet
                open={paste.open}
                onOpenChange={paste.setOpen}
                title={s.pasteTitle}
                closeLabel={m.pasteStepsClose}
                size="content"
                footer={
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="ghost" onPress={() => paste.setOpen(false)}>
                            {s.pasteCancel}
                        </Button>
                        <Button icon="plus" disabled={paste.steps.length === 0} onPress={paste.add}>
                            {pluralOf(s.pasteAdd, paste.steps.length, locale)}
                        </Button>
                    </div>
                }
            >
                <div className="flex flex-col gap-1">
                    <FieldLabel forId={pasteStepsFieldId} label={s.pasteLabel} hint={s.pasteHint} />
                    <TextArea
                        id={pasteStepsFieldId}
                        value={paste.text}
                        minRows={6}
                        describedBy={fieldHintId(pasteStepsFieldId)}
                        onChangeText={paste.setText}
                    />
                </div>
            </Sheet>
        </>
    );
};
