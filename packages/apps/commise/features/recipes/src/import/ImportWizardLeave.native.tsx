/**
 * @module @commise/features-recipes/import — `ImportWizardLeave` (native): the React Native leaf of
 * `./ImportWizardLeave.tsx`, on the same words (`leaveCopyOf`). The house `Sheet`, anchored to the bottom, so Keep
 * reviewing and Save and leave land under the thumb, stacked with Save and leave LAST, nearest it (U11); each fills the
 * sheet's width, so neither label wraps at 320 dp. Not a destructive confirm: leaving loses nothing, and every close
 * route keeps reviewing.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { Sheet } from '@commise/ui/sheet';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { importMessages } from './messages.js';
import type { ImportWizardLeaveProps } from './props.js';
import { leaveCopyOf } from './wizardCopy.js';

/** "Save and leave?" */
export const ImportWizardLeave: FC<ImportWizardLeaveProps> = ({
    open,
    reviewed,
    total,
    resumeAt,
    onKeepReviewing,
    onConfirm,
    saving = false,
}) => {
    const { leave: l, saveAsWritten } = useMessages(importMessages);
    const locale = useLocale();
    const { colors } = useTheme();
    const copy = leaveCopyOf({ reviewed, total, resumeAt }, l, saveAsWritten, locale);
    const body = [styles.body, { color: colors.ink }];

    return (
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onKeepReviewing();
                }
            }}
            title={l.title}
            closeLabel={l.close}
            size="content"
            footer={
                <View style={styles.actions}>
                    <Button variant="secondary" icon="chevronLeft" width="fill" onPress={onKeepReviewing}>
                        {l.keep}
                    </Button>
                    <Button icon="save" width="fill" busy={saving} onPress={onConfirm}>
                        {l.confirm}
                    </Button>
                </View>
            }
        >
            <View style={styles.copy}>
                <Text style={body}>{copy.reviewed}</Text>
                <Text style={body}>{copy.rest}</Text>
                <Text style={body}>{copy.rule}</Text>
                <Text style={body}>{copy.resume}</Text>
            </View>
        </Sheet>
    );
};

const styles = StyleSheet.create({
    copy: { gap: nativeTokens.spacing[3] },
    body: nativeTokens.type.body,
    actions: { gap: nativeTokens.spacing[3] },
});
