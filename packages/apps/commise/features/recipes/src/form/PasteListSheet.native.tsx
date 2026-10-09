/**
 * @module @commise/features-recipes/form — `PasteListSheet` (native): the Paste a list sheet (build spec §7.5.4, §7.12),
 * the React Native leaf of `./PasteListSheet.tsx`, on the same props.
 *
 * It reads no clipboard itself: the field's own system paste menu pastes (Settled 34), so nothing asks for clipboard
 * access. Painted from the theme's roles (D15).
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { FieldLabel, TextArea, fieldHintId } from '@commise/ui/input';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import { Sheet } from '@commise/ui/sheet';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { editorMessages, pluralOf } from '../editor/messages.js';
import { pasteListFieldId } from './fieldIds.js';
import { recipeFormMessages } from './messages.js';
import type { PasteListSheetProps } from './pasteListSheetProps.js';

/** The Paste a list sheet. */
export const PasteListSheet: FC<PasteListSheetProps> = ({ sheet, submitting, failed }) => {
    const { ingredients: t } = useMessages(editorMessages);
    const m = useMessages(recipeFormMessages);
    const locale = useLocale();
    const { colors } = useTheme();
    const { lineCount, refusals, canSubmit } = sheet.model;

    return (
        <Sheet
            open={sheet.open}
            onOpenChange={sheet.setOpen}
            title={t.pasteTitle}
            closeLabel={m.pasteListClose}
            size="content"
            footer={
                <View style={styles.footer}>
                    <Button variant="ghost" onPress={() => sheet.setOpen(false)}>
                        {t.pasteCancel}
                    </Button>
                    <Button icon="plus" disabled={!canSubmit} busy={submitting} onPress={sheet.add}>
                        {pluralOf(t.pasteAdd, lineCount, locale)}
                    </Button>
                </View>
            }
        >
            <View style={styles.field}>
                <FieldLabel forId={pasteListFieldId} label={t.pasteLabel} hint={t.pasteHint} />
                <TextArea
                    id={pasteListFieldId}
                    value={sheet.text}
                    minRows={10}
                    describedBy={fieldHintId(pasteListFieldId)}
                    onChangeText={sheet.setText}
                />
                <Text style={[styles.count, { color: colors.inkMuted }]}>
                    {pluralOf(t.pasteCount, lineCount, locale)}
                </Text>
                {refusals.map((refusal) => (
                    <Text key={refusal} style={[styles.message, { color: colors.dangerText }]}>
                        {refusal}
                    </Text>
                ))}
                <LiveRegion politeness="assertive" style={[styles.message, { color: colors.dangerText }]}>
                    {failed ? t.pasteFailed : ''}
                </LiveRegion>
            </View>
        </Sheet>
    );
};

const styles = StyleSheet.create({
    footer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: nativeTokens.spacing[2] },
    field: { gap: nativeTokens.spacing[1] },
    count: { ...nativeTokens.type.meta, fontVariant: ['tabular-nums'] },
    message: { ...nativeTokens.type.meta },
});
