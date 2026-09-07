/**
 * @module @commise/features-recipes — native public-discovery result card (T076 / W4 S1).
 *
 * The React Native leaf of `RecipeDiscoveryCard`: the same P7
 * composition of the shared {@link RecipeCard} compound parts — tappable cover + title, `by @handle` author
 * attribution (and imported source when present), cuisine/time/calorie meta, visibility badge, rating,
 * tags — plus the Clone action. Same contract as the web leaf so the two cannot drift.
 *
 * The Clone action is the design-system `Button` on the `secondary` tier — the same tier the web leaf and every
 * other clone affordance in the product wear. It previously hand-rolled a coral OUTLINE while the collections
 * rail hand-rolled a coral FILL; see the web leaf's module comment for why the shared "clone is coral" premise
 * is false. Migrating also repaired a real accessibility gap: this leaf set `accessibilityState.busy`, but
 * react-native-web reads `accessibilityState` for `disabled` only, so the in-flight state emitted nothing —
 * the DS `PressScale` carries RN's first-class `aria-busy` alias alongside it.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CloneIcon } from '../actions/icons.js';
import { RecipeCard } from '../card/index.js';
import { fillTemplate } from '../list/model.js';
import { discoveryMessages } from './messages.js';
import type { RecipeDiscoveryCardProps } from './model.js';

/**
 * A single public-recipe search result on React Native.
 *
 * @param props - The card view-model, author handle / source attribution, the per-row clone-busy flag, and
 *   the selection/clone callbacks.
 */
export const RecipeDiscoveryCard: FC<RecipeDiscoveryCardProps> = ({
    recipe,
    authorHandle,
    sourceAttribution,
    isCloning,
    onSelect,
    onClone,
    nutrition,
}) => {
    const discovery = useMessages(discoveryMessages);
    const cloneLabel = fillTemplate(isCloning ? discovery.cloningLabel : discovery.cloneLabel, { title: recipe.title });

    return (
        // The slot only reaches the meta row because this CUSTOM arrangement renders `RecipeCard.Meta` below;
        // an arrangement that drops that part loses the figure silently (see `RecipeCardProps.nutrition`).
        <RecipeCard recipe={recipe} nutrition={nutrition}>
            <Pressable accessibilityRole="button" accessibilityLabel={recipe.title} onPress={() => onSelect(recipe.id)}>
                <RecipeCard.Cover />
                <View style={styles.titleWrap}>
                    <RecipeCard.Title />
                </View>
            </Pressable>
            <View style={styles.body}>
                {authorHandle !== undefined && (
                    <Text style={styles.attribution}>{fillTemplate(discovery.byAuthor, { handle: authorHandle })}</Text>
                )}
                {sourceAttribution !== undefined && (
                    <Text style={styles.attribution}>
                        {fillTemplate(discovery.attribution, { source: sourceAttribution })}
                    </Text>
                )}
                <RecipeCard.Meta />
                <RecipeCard.Badges />
                <RecipeCard.Rating />
                <RecipeCard.Tags />
                {/* `busy` supplies the in-place `ActivityIndicator`, the disabled in-flight guard, and the
                    `accessibilityState.busy` announcement — which this leaf previously set but which never
                    reached the DOM, leaving the in-flight state unobservable. The accessible name is the
                    ROW-UNIQUE template (the visible label is the generic "Clone", which would collide across
                    sibling rows), so it is passed as an explicit override. */}
                <View style={styles.cloneWrap}>
                    <Button
                        variant="secondary"
                        icon={<CloneIcon />}
                        accessibilityLabel={cloneLabel}
                        busy={isCloning}
                        onPress={() => onClone(recipe.id)}
                    >
                        {isCloning ? discovery.cloning : discovery.clone}
                    </Button>
                </View>
            </View>
        </RecipeCard>
    );
};

const styles = StyleSheet.create({
    titleWrap: { paddingHorizontal: nativeTokens.spacing[4], paddingTop: nativeTokens.spacing[4] },
    body: {
        paddingHorizontal: nativeTokens.spacing[4],
        paddingBottom: nativeTokens.spacing[4],
        paddingTop: nativeTokens.spacing[2],
        gap: nativeTokens.spacing[2],
    },
    attribution: { fontSize: 13, color: palette.slate },
    // U7's read still holds — the card must read "tap to open" first, so Clone stays a quiet SECONDARY action
    // rather than a CTA competing with the cover/title. What changed is only WHICH secondary: the DS
    // `secondary` tier instead of a hand-rolled coral outline. `alignItems: 'flex-start'` keeps the pill
    // hugging its label (RN stretches a column's children by default, and the DS Button carries no
    // self-alignment); the 44pt floor, radius, padding and busy affordance now come from the Button itself.
    cloneWrap: { alignItems: 'flex-start', marginTop: nativeTokens.spacing[1] },
});
