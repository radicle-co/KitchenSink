/**
 * @module @commise/features-recipes/editor — `PublishOpenChoicesSheet` (native): the React Native leaf of
 * `./PublishOpenChoicesSheet.tsx`, on the same props and words (`openChoicesCopyOf`). The bottom sheet puts Choose now and
 * Publish anyway side by side at its foot, within thumb reach. Painted from the theme's roles (D15).
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { Sheet } from '@commise/ui/sheet';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { editorMessages } from './messages.js';
import { openChoicesCopyOf } from './openChoicesCopy.js';
import type { PublishOpenChoicesSheetProps } from './publishOpenChoicesSheetProps.js';

/** The publish-with-open-choices sheet. */
export const PublishOpenChoicesSheet: FC<PublishOpenChoicesSheetProps> = ({
    open,
    facts,
    onChooseNow,
    onPublishAnyway,
    onOpenChange,
}) => {
    const copy = openChoicesCopyOf(facts, useMessages(editorMessages), useLocale());
    const { colors } = useTheme();

    return (
        <Sheet
            open={open}
            onOpenChange={onOpenChange}
            title={copy.title}
            closeLabel={copy.close}
            size="content"
            footer={
                <View style={styles.actions}>
                    <View style={styles.action}>
                        <Button variant="secondary" icon="list" width="fill" onPress={onChooseNow}>
                            {copy.chooseNow}
                        </Button>
                    </View>
                    <View style={styles.action}>
                        <Button icon="check" width="fill" onPress={onPublishAnyway}>
                            {copy.publishAnyway}
                        </Button>
                    </View>
                </View>
            }
        >
            <View style={styles.body}>
                <Text style={[styles.lead, { color: colors.ink }]}>{copy.body}</Text>
                {copy.checking !== undefined && (
                    <Text style={[styles.meta, { color: colors.inkMuted }]}>{copy.checking}</Text>
                )}
                <Text style={[styles.meta, { color: colors.inkMuted }]}>{copy.later}</Text>
            </View>
        </Sheet>
    );
};

const styles = StyleSheet.create({
    body: { gap: nativeTokens.spacing[3] },
    lead: { ...nativeTokens.type.body },
    meta: { ...nativeTokens.type.meta },
    actions: { flexDirection: 'row', gap: nativeTokens.spacing[3] },
    action: { flex: 1, minWidth: 0 },
});
