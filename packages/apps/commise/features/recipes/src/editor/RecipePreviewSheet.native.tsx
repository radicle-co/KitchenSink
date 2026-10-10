/**
 * @module @commise/features-recipes/editor — the native editor's Preview (build spec §7.7 item 4): the real detail page
 * of the draft, full screen, under the banner "Preview. This is how it looks to others." Android Back and the close
 * control leave it. It is the detail page itself (`RecipeDetailView`), so what the cook previews is what others see.
 *
 * Its own `ScrollHost` over its own scroller: the detail page's section switch must not reach the editor's.
 *
 * Presentational: props → JSX. Read-only: no owner controls, no rating, no Edit links.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { FullScreenSheet } from '@commise/ui/full-screen-sheet';
import { nativeTokens } from '@commise/ui/native';
import { ScrollHost } from '@commise/ui/scroll-host';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { RecipeDetailView } from '../detail/RecipeDetailView.js';
import { editorMessages } from './messages.js';
import { NO_RETRY, type RecipePreviewSheetProps } from './previewSheetProps.js';

/** The detail page's sections, as its section switch names them. */
const PREVIEW_SECTIONS = ['ingredients', 'steps', 'nutrition'] as const;

/** The native Preview sheet. */
export const RecipePreviewSheet: FC<RecipePreviewSheetProps> = ({ open, recipe, onClose }) => {
    const m = useMessages(editorMessages);
    const { colors } = useTheme();

    if (!open) {
        return null;
    }

    return (
        <FullScreenSheet label={m.preview} onRequestClose={onClose}>
            <View style={styles.bar}>
                <Text style={[styles.banner, { color: colors.ink }]}>{m.previewBanner}</Text>
                <Button variant="ghost" icon="x" onPress={onClose}>
                    {m.previewClose}
                </Button>
            </View>
            <ScrollHost sections={PREVIEW_SECTIONS}>
                {(bind) => (
                    <ScrollView {...bind} style={styles.scroll}>
                        <RecipeDetailView recipe={recipe} unreachableRetry={NO_RETRY} />
                    </ScrollView>
                )}
            </ScrollHost>
        </FullScreenSheet>
    );
};

const styles = StyleSheet.create({
    bar: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[2] },
    banner: { ...nativeTokens.type.meta, flex: 1 },
    scroll: { flex: 1 },
});
