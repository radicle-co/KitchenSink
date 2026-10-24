/**
 * @module @commise/features-recipes/actions — the native Premium sheet for "Private" in the recipe editor, the twin of the
 * web leaf (build spec §6.4, §7.7 item 2): the plain fact, then **See Premium** and **Not now**, both secondary `md`
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

import { recipeActionMessages } from './messages.js';
import type { RecipeUpsellSheetProps } from './model.js';

/** The native Premium sheet for a private recipe. */
export const RecipeUpsellSheet: FC<RecipeUpsellSheetProps> = ({ open, onOpenChange, onSeePremium }) => {
    const { upsell } = useMessages(recipeActionMessages);
    const { colors } = useTheme();

    return (
        <Sheet
            open={open}
            onOpenChange={onOpenChange}
            title={upsell.title}
            closeLabel={upsell.close}
            size="content"
            footer={
                <View style={styles.footer}>
                    <View style={styles.half}>
                        <Button variant="secondary" icon="star" width="fill" onPress={onSeePremium}>
                            {upsell.seePremium}
                        </Button>
                    </View>
                    <View style={styles.half}>
                        <Button variant="secondary" icon="x" width="fill" onPress={() => onOpenChange(false)}>
                            {upsell.notNow}
                        </Button>
                    </View>
                </View>
            }
        >
            <Text style={[styles.body, { color: colors.inkMuted }]}>{upsell.body}</Text>
        </Sheet>
    );
};

const styles = StyleSheet.create({
    footer: { flexDirection: 'row', gap: nativeTokens.spacing[3] },
    half: { flex: 1 },
    body: { ...nativeTokens.type.body },
});
