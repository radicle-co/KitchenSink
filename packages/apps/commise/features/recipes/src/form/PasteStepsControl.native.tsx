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
import { FieldLabel, TextArea, fieldHintId } from '@commise/ui/input';
import { nativeTokens } from '@commise/ui/native';
import { Sheet } from '@commise/ui/sheet';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

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
                    <View style={styles.footer}>
                        <Button variant="ghost" onPress={() => paste.setOpen(false)}>
                            {s.pasteCancel}
                        </Button>
                        <Button icon="plus" disabled={paste.steps.length === 0} onPress={paste.add}>
                            {pluralOf(s.pasteAdd, paste.steps.length, locale)}
                        </Button>
                    </View>
                }
            >
                <View style={styles.field}>
                    <FieldLabel forId={pasteStepsFieldId} label={s.pasteLabel} hint={s.pasteHint} />
                    <TextArea
                        id={pasteStepsFieldId}
                        value={paste.text}
                        minRows={6}
                        describedBy={fieldHintId(pasteStepsFieldId)}
                        onChangeText={paste.setText}
                    />
                </View>
            </Sheet>
        </>
    );
};

const styles = StyleSheet.create({
    footer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: nativeTokens.spacing[2] },
    field: { gap: nativeTokens.spacing[1] },
});
