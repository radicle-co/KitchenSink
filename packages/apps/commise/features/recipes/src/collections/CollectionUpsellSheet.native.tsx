/**
 * @module @commise/features-recipes/collections — the native Premium sheet for "Make private", the twin of the web leaf
 * (`docs/design/uiOverhaul/buildSpec.md` §5.2): the plain fact, then **See Premium** and **Not now**, both secondary `md`
 * buttons of equal size side by side, nothing pre-selected (DSA Art. 25). The host closes the sheet on See Premium: the
 * subscription surface is not built yet (010).
 *
 * Presentational: it sends nothing; the host decides what follows.
 *
 * @pattern Adapter over the design-system `Sheet`
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { Sheet } from '@commise/ui/sheet';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { CollectionUpsellSheetProps } from './detailModel.js';
import { collectionMessages } from './messages.js';

export const CollectionUpsellSheet: FC<CollectionUpsellSheetProps> = ({ open, onOpenChange, onSeePremium }) => {
    const { dialogs } = useMessages(collectionMessages);
    const { colors } = useTheme();

    return (
        <Sheet
            open={open}
            onOpenChange={onOpenChange}
            title={dialogs.upsellTitle}
            closeLabel={dialogs.upsellClose}
            size="content"
            footer={
                <View style={styles.footer}>
                    <View style={styles.half}>
                        <Button variant="secondary" icon="star" width="fill" onPress={onSeePremium}>
                            {dialogs.upsellSee}
                        </Button>
                    </View>
                    <View style={styles.half}>
                        <Button variant="secondary" icon="x" width="fill" onPress={() => onOpenChange(false)}>
                            {dialogs.upsellNotNow}
                        </Button>
                    </View>
                </View>
            }
        >
            <Text style={[styles.body, { color: colors.inkMuted }]}>{dialogs.upsellBody}</Text>
        </Sheet>
    );
};

const styles = StyleSheet.create({
    footer: { flexDirection: 'row', gap: nativeTokens.spacing[3] },
    half: { flex: 1 },
    body: { ...nativeTokens.type.body },
});
