/**
 * @module @commise/features-recipes/form — `PasteProgressBlock` (native): the React Native leaf of
 * `./PasteProgressBlock.tsx`, on the same props and words. The count and status read as ONE accessible element, and the
 * actions sit on their own line, wrapping between buttons (never inside one) at 320 px.
 *
 * It holds a ref for the same reason as the web leaf: after an action its own control may disappear, and the screen
 * reader must land on the block rather than nowhere.
 *
 * @pattern Adapter over `useScreenReaderFocusOnSignal` — the screen-reader focus move the action's signal asks for
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { recipeFormMessages } from './messages.js';
import type { PasteProgressBlockProps } from './pasteProgressBlockProps.js';
import { pasteProgressViewOf } from './pasteStatusCopy.js';

/** The progress block over a paste. */
export const PasteProgressBlock: FC<PasteProgressBlockProps> = ({
    progress,
    onRetryParse,
    onAddRestAsWritten,
    retryFailed,
    focusSignal,
}) => {
    const m = useMessages(recipeFormMessages);
    const locale = useLocale();
    const { colors } = useTheme();
    const view = pasteProgressViewOf(progress, m, locale, retryFailed);
    const block = useScreenReaderFocusOnSignal<View>(focusSignal);
    const color = view.tone === 'attention' ? colors.attention : colors.inkMuted;
    const label = [view.title, view.status, view.hint, view.failure].filter((part) => part !== undefined).join('. ');

    return (
        <View style={styles.block}>
            <View ref={block} accessible accessibilityLabel={label} style={styles.summary}>
                <Text style={[styles.title, { color: colors.ink }]}>{view.title}</Text>
                <View style={styles.status}>
                    <Icon name={view.icon} size={16} tone={view.tone} />
                    <Text style={[styles.caption, { color }]}>{view.status}</Text>
                </View>
                {view.hint !== undefined && (
                    <Text style={[styles.caption, { color: colors.inkMuted }]}>{view.hint}</Text>
                )}
                {view.failure !== undefined && (
                    <View style={styles.status}>
                        <Icon name="triangleAlert" size={16} tone="attention" />
                        <Text style={[styles.caption, { color: colors.attention }]}>{view.failure}</Text>
                    </View>
                )}
            </View>
            {(view.retryLabel !== undefined || view.addRestLabel !== undefined) && (
                <View style={styles.actions}>
                    {view.retryLabel !== undefined && (
                        <Button
                            variant="ghost"
                            size="sm"
                            icon="refreshCw"
                            accessibilityLabel={view.retryLabel}
                            onPress={onRetryParse}
                        >
                            {m.statusActionRetry}
                        </Button>
                    )}
                    {view.addRestLabel !== undefined && (
                        <Button
                            variant="ghost"
                            size="sm"
                            icon="listPlus"
                            accessibilityLabel={view.addRestLabel}
                            onPress={onAddRestAsWritten}
                        >
                            {m.pasteAddRestAsWritten}
                        </Button>
                    )}
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    block: { gap: nativeTokens.spacing[1], paddingVertical: nativeTokens.spacing[2] },
    summary: { gap: nativeTokens.spacing[1] },
    title: { ...nativeTokens.type.body, fontVariant: ['tabular-nums'] },
    status: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[2] },
    caption: { ...nativeTokens.type.caption, flexShrink: 1 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: nativeTokens.spacing[2] },
});
