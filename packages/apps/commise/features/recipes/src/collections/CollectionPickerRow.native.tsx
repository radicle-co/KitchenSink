/**
 * @module @commise/features-recipes/collections — one row of the native add-recipes picker, the twin of the web leaf
 * (`docs/design/uiOverhaul/buildSpec.md` §5.3): 64 pt tall, a 48 pt thumbnail, the title (two lines), one meta line
 * (cuisine · time), and a trailing 28 pt circle — off: a `lineControl` outline; on: `action` filled with a check. The whole
 * row is ONE control, a `checkbox` with its checked state, named by the recipe.
 *
 * Each press asks for the OPPOSITE of what the row shows and the host saves it at once; a refused toggle flips the row back
 * and an inline alert names the recipe. The state glyph is a check, so checked never rests on colour alone. Colour is read
 * from the theme at render (D15).
 *
 * Presentational: it sends nothing; the host runs the toggle.
 */
import { useMessages } from '@commise/i18n/react';
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { RecipeCover } from '@commise/ui/recipe-cover';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { toRecipeCardModel } from '../card/model.js';
import { useRecipeCardView } from '../card/useRecipeCardView.js';
import { fillTemplate } from '../list/model.js';
import type { CollectionPickerRowProps } from './detailModel.js';
import { collectionMessages } from './messages.js';

export const CollectionPickerRow: FC<CollectionPickerRowProps> = ({ recipe, checked, failed, onToggle }) => {
    const { picker } = useMessages(collectionMessages);
    const { colors } = useTheme();
    const model = toRecipeCardModel(recipe);
    const view = useRecipeCardView(model);
    const meta = [recipe.cuisine, view.meta.duration].filter(
        (part): part is string => part !== undefined && part !== '',
    );

    return (
        <View style={styles.stack}>
            <Pressable
                role="checkbox"
                aria-checked={checked}
                aria-label={recipe.title}
                accessibilityState={{ checked }}
                onPress={() => onToggle(!checked)}
                style={({ pressed }) => [styles.row, pressed ? { backgroundColor: colors.surfaceMuted } : null]}
            >
                <View aria-hidden style={styles.thumb}>
                    <RecipeCover
                        recipeId={recipe.id}
                        title={recipe.title}
                        aspect="1:1"
                        {...(recipe.cuisine === undefined ? {} : { cuisine: recipe.cuisine })}
                        {...(recipe.coverPhotoUrl === undefined ? {} : { photoUrl: recipe.coverPhotoUrl })}
                    />
                </View>
                <View style={styles.text}>
                    <Text numberOfLines={2} style={[styles.title, { color: colors.ink }]}>
                        {recipe.title}
                    </Text>
                    <Text numberOfLines={1} style={[styles.meta, { color: colors.inkMuted }]}>
                        {meta.join(' · ')}
                    </Text>
                </View>
                <View
                    aria-hidden
                    style={[
                        styles.circle,
                        checked
                            ? { backgroundColor: colors.action }
                            : { borderColor: colors.lineControl, borderWidth: 2 },
                    ]}
                >
                    {checked ? <Icon name="check" size={16} tone="onAction" /> : null}
                </View>
            </Pressable>
            {failed === undefined ? null : (
                <Text role="alert" style={[styles.meta, styles.alert, { color: colors.dangerText }]}>
                    {fillTemplate(failed === 'add' ? picker.toggleAddFailed : picker.toggleRemoveFailed, {
                        title: recipe.title,
                    })}
                </Text>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    stack: { gap: nativeTokens.spacing[1] },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[3],
        minHeight: 64,
        paddingHorizontal: nativeTokens.spacing[2],
        paddingVertical: nativeTokens.spacing[2],
        borderRadius: nativeTokens.radius.md,
    },
    thumb: { width: 48, height: 48, borderRadius: nativeTokens.radius.md, overflow: 'hidden' },
    text: { flex: 1, minWidth: 0 },
    title: { ...nativeTokens.type.cardTitle },
    meta: { ...nativeTokens.type.meta },
    circle: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    alert: { paddingHorizontal: nativeTokens.spacing[2] },
});
