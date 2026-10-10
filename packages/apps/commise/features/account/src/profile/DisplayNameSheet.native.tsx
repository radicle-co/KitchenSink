/**
 * @module @commise/features-account/profile/DisplayNameSheet — the display-name sheet (native): "What should we call
 * you?", one field and Save (`buildSpec.md` §9.1).
 *
 * The name can show publicly as an author handle, so this sheet is the only place the app asks for it and it saves
 * only when Save is pressed (or Return in the field) — never on close and never from the prefill alone. Controlled and
 * stateless: the page owns the draft, the gate (`canSaveDisplayName`) and the write.
 *
 * @pattern Adapter over the design-system `Sheet`, `Input` and `FieldLabel`
 */
import { Button } from '@commise/ui/button';
import { FieldLabel, fieldHintId, Input } from '@commise/ui/input';
import { Sheet } from '@commise/ui/sheet';
import { useTheme } from '@commise/ui/theme';
import { nativeTokens } from '@commise/ui/native';
import { useMessages } from '@commise/i18n/react';
import { useId, type FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { profileMessages } from './messages.js';
import { DISPLAY_NAME_MAX_LENGTH } from './model.js';
import type { DisplayNameSheetProps } from './props.js';

/** The display-name sheet. */
export const DisplayNameSheet: FC<DisplayNameSheetProps> = ({
    open,
    onOpenChange,
    draft,
    onDraftChange,
    canSave,
    saving,
    failed,
    onSave,
}) => {
    const t = useMessages(profileMessages);
    const { colors } = useTheme();
    const fieldId = useId();
    const errorId = useId();

    return (
        <Sheet
            open={open}
            onOpenChange={onOpenChange}
            title={t.namePrompt}
            closeLabel={t.closeNameSheet}
            size="content"
            footer={
                <Button icon="check" width="fill" busy={saving} disabled={!canSave} onPress={onSave}>
                    {saving ? t.saving : t.save}
                </Button>
            }
        >
            <View style={styles.body}>
                <FieldLabel forId={fieldId} label={t.displayName} hint={t.nameHint} />
                <Input
                    id={fieldId}
                    value={draft}
                    onChangeText={onDraftChange}
                    autoComplete="name"
                    autoCapitalize="words"
                    enterKeyHint="done"
                    maxLength={DISPLAY_NAME_MAX_LENGTH}
                    invalid={failed}
                    describedBy={failed ? `${fieldHintId(fieldId)} ${errorId}` : fieldHintId(fieldId)}
                    onSubmit={() => {
                        if (canSave && !saving) {
                            onSave();
                        }
                    }}
                />
                {failed ? (
                    <Text role="alert" nativeID={errorId} style={[styles.error, { color: colors.dangerText }]}>
                        {t.saveFailed}
                    </Text>
                ) : null}
            </View>
        </Sheet>
    );
};

const styles = StyleSheet.create({
    // No padding of its own: the sheet already pads its content, and a second inset narrowed the field.
    body: { gap: nativeTokens.spacing[2] },
    error: { ...nativeTokens.type.meta },
});
