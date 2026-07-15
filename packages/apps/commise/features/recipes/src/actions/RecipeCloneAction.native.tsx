/**
 * @module @commise/features-recipes — native recipe clone action (T075 building block).
 *
 * The React Native leaf of {@link import('./RecipeCloneAction.js').RecipeCloneAction} — same controlled
 * contract: a clone button disabled when cloning is not allowed (`!canClone`) or in flight (`cloning`) and
 * marked busy while cloning, plus a source-attribution line rendered only when `sourceAttribution` is set.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { recipeActionMessages } from './messages.js';
import type { RecipeCloneActionProps } from './model.js';

export const RecipeCloneAction: FC<RecipeCloneActionProps> = ({
    canClone,
    sourceAttribution,
    cloning = false,
    onClone,
}) => {
    const { clone } = useMessages(recipeActionMessages);

    return (
        <View style={styles.wrap}>
            {sourceAttribution !== undefined && sourceAttribution.length > 0 && (
                <Text style={styles.attribution}>{fillTemplate(clone.attribution, { source: sourceAttribution })}</Text>
            )}
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={clone.clone}
                aria-busy={cloning || undefined}
                disabled={cloning || !canClone}
                onPress={onClone}
                style={[styles.button, (cloning || !canClone) && styles.buttonDisabled]}
            >
                <Text style={styles.label}>{clone.clone}</Text>
            </Pressable>
            {cloning && <Text style={styles.attribution}>{clone.cloningLabel}</Text>}
        </View>
    );
};

const styles = StyleSheet.create({
    wrap: { gap: 8 },
    attribution: { fontSize: 13, color: palette.slate },
    button: {
        alignSelf: 'flex-start',
        backgroundColor: palette.coral,
        borderRadius: 999,
        paddingVertical: 10,
        paddingHorizontal: 20,
    },
    buttonDisabled: { opacity: 0.6 },
    label: { color: palette.white, fontWeight: '600', fontSize: 14 },
});
