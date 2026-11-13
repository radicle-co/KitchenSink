/**
 * @module @commise/features-recipes/form — `PasteStepsControl` (native): "Paste steps"
 * (`docs/design/uiOverhaul/buildSpec.md` §7.6, §7.12), the React Native leaf of `./PasteStepsControl.tsx`, on the same
 * props and the same state (`usePasteSteps`).
 *
 * It reads no clipboard itself: the field's own system paste menu pastes (Settled 34), so nothing asks for clipboard
 * access.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { FieldLabel, TextArea } from '@commise/ui/input';
import { nativeTokens } from '@commise/ui/native';
import { Sheet } from '@commise/ui/sheet';
import { Text } from '@commise/ui/text';
import type { SourceLinkExtraction } from '@kitchensink/recipe-core';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { editorMessages } from '../editor/messages.js';
import { pluralOf } from '@commise/i18n';
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
                    <Button icon="plus" width="fill" disabled={paste.steps.length === 0} onPress={paste.add}>
                        {pluralOf(s.pasteAdd, paste.steps.length, locale)}
                    </Button>
                }
            >
                <View style={styles.field}>
                    <FieldLabel forId={pasteStepsFieldId} label={s.pasteLabel} hint={hint} />
                    <TextArea
                        id={pasteStepsFieldId}
                        value={paste.text}
                        minRows={6}
                        label={s.pasteLabel}
                        hint={hint}
                        onChangeText={paste.setText}
                    />
                    {paste.linkOnly ? (
                        <Text typeRole="meta" color="$inkMuted">
                            {source.linkOnly}
                        </Text>
                    ) : null}
                </View>
            </Sheet>
        </>
    );
};

const styles = StyleSheet.create({
    field: { gap: nativeTokens.spacing[1] },
});
