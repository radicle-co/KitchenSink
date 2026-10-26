/**
 * @module @commise/features-recipes/actions - the native refusal of "Save a copy" when the copy would be private and every
 * private slot is in use, the twin of `RecipeSaveCopyNoSlot.tsx` (board `RecipeSaveCopyNoSlotMobile`): a bottom sheet with
 * the fact, **Not now** and **See Premium** (primary) where paid features are shown, a single **OK** where they are hidden.
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

import { fillTemplate } from '../format/fillTemplate.js';
import { recipeActionMessages } from './messages.js';
import type { RecipeSaveCopyNoSlotProps } from './model.js';

/** The native refusal of a copy that has no private slot to land in. */
export const RecipeSaveCopyNoSlot: FC<RecipeSaveCopyNoSlotProps> = ({ open, total, offer, onClose }) => {
    const { cloneNoSlot: m } = useMessages(recipeActionMessages);
    const { colors } = useTheme();
    const body = fillTemplate(offer.kind === 'premium' ? m.body : m.bodyNoPremium, { total });

    return (
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
            title={m.title}
            closeLabel={m.close}
            size="content"
            footer={
                offer.kind === 'premium' ? (
                    <View style={styles.footer}>
                        <View style={styles.half}>
                            <Button variant="secondary" icon="x" width="fill" onPress={onClose}>
                                {m.notNow}
                            </Button>
                        </View>
                        <View style={styles.half}>
                            <Button variant="primary" icon="star" width="fill" onPress={offer.onSeePremium}>
                                {m.seePremium}
                            </Button>
                        </View>
                    </View>
                ) : (
                    <Button variant="primary" icon="check" width="fill" onPress={onClose}>
                        {m.ok}
                    </Button>
                )
            }
        >
            <Text style={[styles.body, { color: colors.inkMuted }]}>{body}</Text>
        </Sheet>
    );
};

const styles = StyleSheet.create({
    footer: { flexDirection: 'row', gap: nativeTokens.spacing[3] },
    half: { flex: 1 },
    body: { ...nativeTokens.type.body },
});
