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
import type { SourceLinkExtraction } from '@kitchensink/recipe-core';
import type { FC } from 'react';

import { editorMessages } from '../editor/messages.js';
import { pluralOf } from '../format/plural.js';
import { pasteStepsFieldId } from './fieldIds.js';
import { recipeFormMessages } from './messages.js';
import { usePasteSteps } from './usePasteSteps.js';

/** Props for {@link PasteStepsControl}. */
export interface PasteStepsControlProps {
    /** Called with the pasted steps, in order, when the cook adds them. */
    readonly onAdd: (instructions: readonly string[]) => void;
    /**
     * A link line the pasted steps carried (ADR-0089): it is taken out of the steps and handed up to set the recipe's Source.
     * Absent where there is no Source to set.
     */
    readonly onSource?: (extraction: SourceLinkExtraction) => void;
    /**
     * Whether the Source can still be set, so the hint says a link may be pasted too. It follows the Source's lock: a
     * published recipe still takes steps, and its source cannot change. Display only.
     */
    readonly offersSource?: boolean;
    /**
     * The button is asked for focus (the paste caption's Remove sends the cook back to the control they used). A level, until
     * {@link PasteStepsControlProps.onFocusHandled}.
     */
    readonly focusRequested?: boolean;
    /** The button took a requested focus. */
    readonly onFocusHandled?: () => void;
}

/** "Paste steps": the button and its sheet. */
export const PasteStepsControl: FC<PasteStepsControlProps> = ({
    onAdd,
    onSource,
    offersSource = false,
    focusRequested = false,
    onFocusHandled,
}) => {
    const { steps: s, source } = useMessages(editorMessages);
    const m = useMessages(recipeFormMessages);
    const locale = useLocale();
    const paste = usePasteSteps(onAdd, onSource);
    const hint = offersSource ? `${s.pasteHint} ${s.pasteLinkHint}` : s.pasteHint;

    return (
        <>
            <Button
                variant="ghost"
                icon="listPlus"
                focusRequested={focusRequested}
                {...(onFocusHandled === undefined ? {} : { onFocusRequestHandled: onFocusHandled })}
                onPress={() => paste.setOpen(true)}
            >
                {s.paste}
            </Button>
            <Sheet
                open={paste.open}
                onOpenChange={paste.setOpen}
                title={s.pasteTitle}
                closeLabel={m.pasteStepsClose}
                size="content"
                footer={
                    /* Below 840 the primary fills the sheet and the × is the only way out; at 840+ a ghost Cancel sits beside a
                        content-width primary (`buildSpec.md` §5.1, F11). */
                    <div className="flex flex-col gap-3 nav:flex-row nav:justify-end">
                        <div className="hidden nav:block">
                            <Button variant="ghost" onPress={() => paste.setOpen(false)}>
                                {s.pasteCancel}
                            </Button>
                        </div>
                        <div>
                            <Button icon="plus" width="fill" disabled={paste.steps.length === 0} onPress={paste.add}>
                                {pluralOf(s.pasteAdd, paste.steps.length, locale)}
                            </Button>
                        </div>
                    </div>
                }
            >
                <div className="flex flex-col gap-1">
                    <FieldLabel forId={pasteStepsFieldId} label={s.pasteLabel} hint={hint} />
                    <TextArea
                        id={pasteStepsFieldId}
                        value={paste.text}
                        minRows={6}
                        describedBy={fieldHintId(pasteStepsFieldId)}
                        onChangeText={paste.setText}
                    />
                    {paste.linkOnly ? <p className="text-meta text-ink-muted">{source.linkOnly}</p> : null}
                </div>
            </Sheet>
        </>
    );
};
