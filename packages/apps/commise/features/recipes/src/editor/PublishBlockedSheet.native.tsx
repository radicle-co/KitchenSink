/**
 * @module @commise/features-recipes/editor — `PublishBlockedSheet` (native): the React Native leaf of
 * `./PublishBlockedSheet.tsx`, on the same props and words. A bottom sheet whose two actions, Keep as draft and Publish as
 * public, sit side by side with EQUAL weight (both the secondary pill, neither preselected). The platform Back route, a
 * tap on the scrim and Close all mean Keep as draft (`onKeepDraft`): dismissing never publishes.
 *
 * @pattern Adapter over the design-system `Sheet` — the platform expression of the web leaf
 */
import { SUBSCRIPTION_ENTRY_POINTS_ON } from '@commise/features-account';
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { Sheet } from '@commise/ui/sheet';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { editorMessages } from './messages.js';
import { publishBlockedCopyOf } from './publishBlockedCopy.js';
import type { PublishBlockedSheetProps } from './publishBlockedSheetProps.js';

/** The blocked-publish sheet. */
export const PublishBlockedSheet: FC<PublishBlockedSheetProps> = ({
    open,
    slotTotal,
    onKeepDraft,
    onPublishPublic,
    webSource = false,
}) => {
    const { publishBlocked: m } = useMessages(editorMessages);
    const copy = publishBlockedCopyOf(slotTotal, m, SUBSCRIPTION_ENTRY_POINTS_ON, undefined, webSource);
    const { colors } = useTheme();

    return (
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onKeepDraft();
                }
            }}
            title={copy.title}
            closeLabel={m.close}
            size="content"
            presentation="dialog"
            footer={
                <View style={styles.actions}>
                    <View style={styles.action}>
                        <Button variant="secondary" icon="pencilLine" width="fill" onPress={onKeepDraft}>
                            {m.keepDraft}
                        </Button>
                    </View>
                    {onPublishPublic === undefined ? null : (
                        <View style={styles.action}>
                            <Button variant="secondary" icon="globe" width="fill" onPress={onPublishPublic}>
                                {m.publishPublic}
                            </Button>
                        </View>
                    )}
                </View>
            }
        >
            <View style={styles.body}>
                <Text style={[styles.lead, { color: colors.ink }]}>{copy.body}</Text>
                {copy.upsell === undefined ? null : (
                    <Text style={[styles.meta, { color: colors.inkMuted }]}>{copy.upsell}</Text>
                )}
            </View>
        </Sheet>
    );
};

const styles = StyleSheet.create({
    body: { gap: nativeTokens.spacing[3] },
    lead: { ...nativeTokens.type.body },
    meta: { ...nativeTokens.type.list },
    actions: { flexDirection: 'row', gap: nativeTokens.spacing[3] },
    action: { flex: 1 },
});
