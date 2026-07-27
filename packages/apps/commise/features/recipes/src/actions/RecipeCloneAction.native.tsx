/**
 * @module @commise/features-recipes — native recipe clone action (T075 building block).
 *
 * The React Native leaf of {@link import('./RecipeCloneAction.js').RecipeCloneAction} — same controlled
 * contract: a clone button disabled when cloning is not allowed (`!canClone`) or in flight (`cloning`) and
 * marked busy while cloning, plus a source-attribution line rendered only when `sourceAttribution` is set.
 *
 * ## Why this is NOT the design-system `Button`
 *
 * The clone action is painted CORAL in the product's visual language, and the DS variant set has exactly three
 * tiers — `primary` (the seafoam→ocean-dark brand gradient), `secondary` (bordered white), `destructive`
 * (bordered error). None is coral, so routing this control through `Button` would silently RECOLOUR it to the
 * brand gradient. It would also diverge from the web leaf, which stays hand-rolled for this same reason and
 * records it as an open DS-variant question rather than papering over it — so migrating only native would break
 * cross-platform parity in the other direction. The correct fix is a DS accent/coral tier adopted by BOTH
 * leaves in one change; that is a design-system decision, not something to smuggle in from the native side.
 *
 * What the DS Button WOULD have supplied is supplied here instead — the 44pt touch floor, the shared
 * radius/spacing scale, and a real busy announcement — and each is pinned by a test, so "kept hand-rolled for
 * a good reason" cannot decay into "kept the defects".
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
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
            {/* `aria-busy` is React Native's own first-class ALIAS for `accessibilityState.busy` (declared in
                `ViewAccessibility.d.ts`), not a web-only attribute — so it announces the in-flight state to
                VoiceOver/TalkBack on device. It is preferred over the `accessibilityState` object form here
                because react-native-web surfaces the alias in the DOM while it does NOT map
                `accessibilityState.busy`, so this form is the one that is both device-correct AND assertable. */}
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
    wrap: { gap: nativeTokens.spacing[2] },
    attribution: { fontSize: 13, color: palette.slate },
    // Geometry matched to the DS Button pill (44pt floor, `radius.full`, tokenized padding); only the FILL
    // differs, and that difference is the documented reason this is not the Button (see the module doc).
    button: {
        alignSelf: 'flex-start',
        minHeight: 44,
        justifyContent: 'center',
        backgroundColor: palette.coral,
        borderRadius: nativeTokens.radius.full,
        paddingVertical: nativeTokens.spacing[3],
        paddingHorizontal: nativeTokens.spacing[5],
    },
    buttonDisabled: { opacity: 0.6 },
    label: { color: palette.white, fontWeight: '600', fontSize: nativeTokens.fontSize.bodySm },
});
