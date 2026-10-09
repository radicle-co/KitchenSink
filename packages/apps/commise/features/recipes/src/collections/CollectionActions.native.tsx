/**
 * @module @commise/features-recipes — native collection-actions sidebar (W5 Task 7 building block).
 *
 * The React Native leaf of `CollectionActions` — same presentational
 * contract: Add Recipes, a clone-only Pull Updates action (FR-011), Clone Collection, and a two-stage,
 * `canGoPrivate`-gated (C1, FR-010) Public/Private visibility toggle with a Save action, rendered with RN
 * primitives. `canGoPrivate`/`disabledReason` arrive as plain, already-resolved values from the composing
 * container — the gate is that one boolean prop; this leaf holds no eligibility logic of its own.
 *
 * Clone Collection is the design-system `Button` (`secondary`) — the SAME tier as the web leaf and as every
 * other clone affordance in the product. It used to hand-roll `backgroundColor: palette.coral` with a white
 * label; see the web leaf's module comment for the full reasoning (no mockup has a clone action; the mockups
 * never fill a button coral; coral is the danger register) and for why this panel's seafoam siblings are
 * deliberately still hand-rolled pending the `semantic.secondary === palette.coral` decision.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { Button } from '@commise/ui/button';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RecipeVisibility } from '@kitchensink/recipe-core';

import { collectionMessages } from './messages.js';
import type { CollectionActionsProps } from './model.js';

export const CollectionActions: FC<CollectionActionsProps> = ({
    isCloned,
    visibility,
    pendingVisibility,
    canGoPrivate,
    disabledReason,
    isCloning,
    isPulling,
    onAddRecipes,
    onPullUpdates,
    onClone,
    onVisibilityChange,
    onSaveVisibility,
}) => {
    const { actions } = useMessages(collectionMessages);
    const showReason = !canGoPrivate && disabledReason !== undefined && disabledReason.length > 0;
    const canSave = pendingVisibility !== visibility;
    const isPublic = pendingVisibility === RecipeVisibility.PUBLIC;
    const isPrivate = pendingVisibility === RecipeVisibility.PRIVATE;

    // The gate is enforced in the handler too, not only via `disabled`: the component must never emit a
    // transition to `private` when `canGoPrivate` is false, however the event arrives.
    const selectPrivate = () => {
        if (canGoPrivate) {
            onVisibilityChange(RecipeVisibility.PRIVATE);
        }
    };

    return (
        <View collapsable={false} accessibilityLabel={actions.heading} style={styles.container}>
            <View style={styles.buttonStack}>
                <Button icon="plus" onPress={onAddRecipes}>
                    {actions.addRecipes}
                </Button>
                {isCloned && (
                    <View style={styles.actionGroup}>
                        <Button variant="secondary" icon="refreshCw" busy={isPulling} onPress={onPullUpdates}>
                            {actions.pullUpdates}
                        </Button>
                        {isPulling && <Text style={styles.statusLabel}>{actions.pullingLabel}</Text>}
                    </View>
                )}
                <View style={styles.actionGroup}>
                    {/* `busy` supplies the in-place `ActivityIndicator`, the disabled in-flight guard (so the
                        clone cannot be double-fired), and the `accessibilityState.busy` announcement. */}
                    <Button variant="secondary" icon="copyPlus" busy={isCloning} onPress={onClone}>
                        {actions.cloneCollection}
                    </Button>
                    {isCloning && <Text style={styles.statusLabel}>{actions.cloningLabel}</Text>}
                </View>
            </View>

            <View
                collapsable={false}
                accessibilityRole="radiogroup"
                accessibilityLabel={actions.visibilityGroupLabel}
                style={styles.wrap}
            >
                <View style={styles.segment}>
                    <Pressable
                        accessibilityRole="radio"
                        accessibilityLabel={actions.makePublic}
                        aria-checked={isPublic}
                        onPress={() => onVisibilityChange(RecipeVisibility.PUBLIC)}
                        style={[styles.option, isPublic && styles.optionActive]}
                    >
                        <Text style={[styles.optionLabel, isPublic && styles.optionLabelActive]}>
                            {actions.makePublic}
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="radio"
                        accessibilityLabel={actions.makePrivate}
                        aria-checked={isPrivate}
                        disabled={!canGoPrivate}
                        onPress={selectPrivate}
                        style={[
                            styles.option,
                            isPrivate && styles.optionActive,
                            !canGoPrivate && styles.optionDisabled,
                        ]}
                    >
                        <Text style={[styles.optionLabel, isPrivate && styles.optionLabelActive]}>
                            {actions.makePrivate}
                        </Text>
                    </Pressable>
                </View>
                {showReason && <Text style={styles.reason}>{disabledReason}</Text>}
                <View style={styles.saveAction}>
                    <Button variant="ghost" icon="check" disabled={!canSave} onPress={onSaveVisibility}>
                        {actions.saveVisibility}
                    </Button>
                </View>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { gap: 16, padding: 20, borderRadius: 16, backgroundColor: palette.white },
    // Every action hugs its label (RN stretches a column's children; the DS Button carries no self-alignment).
    buttonStack: { gap: 8, alignItems: 'flex-start' },
    // `alignItems: 'flex-start'` keeps the pill hugging its label rather than stretching to the rail's full
    // width — the job the removed `alignSelf: 'flex-start'` on the hand-rolled clone surface did. (RN stretches
    // a column's children by default; the DS Button carries no self-alignment of its own.) Mirrors the web
    // leaf's `items-start`.
    actionGroup: { gap: 4, alignItems: 'flex-start' },
    statusLabel: { fontSize: 13, color: palette.slate },
    wrap: { gap: 8 },
    segment: {
        flexDirection: 'row',
        alignSelf: 'flex-start',
        gap: 4,
        backgroundColor: palette.pearl,
        borderRadius: 999,
        padding: 4,
    },
    option: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 18 },
    optionActive: { backgroundColor: palette.white },
    optionDisabled: { opacity: 0.5 },
    optionLabel: { fontSize: 14, fontWeight: '500', color: palette.slate },
    optionLabelActive: { color: palette.charcoal, fontWeight: '600' },
    reason: { fontSize: 13, color: palette['warning-dark'] },
    saveAction: { alignSelf: 'flex-start' },
});
