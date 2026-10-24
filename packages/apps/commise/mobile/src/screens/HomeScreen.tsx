/**
 * Home screen (mobile): the Home tab's root (`docs/design/uiOverhaul/buildSpec.md` §4.2). It composes the
 * {@link HomeWidgetSurface} — whose scroller takes the screen's `ScrollHost` bind and whose first child is the large
 * title — and floats two things over it: the condensed title bar, once the greeting scrolls under the top, and the
 * floating "New recipe" button, a sibling after the scroller so it stays put.
 *
 * One tap opens the empty editor (§3.4, D4). The button yields while the recent-recipes page the widget reads is
 * loading (so it never appears and cannot vanish) and on the first run (a settled empty page), whose own start buttons
 * take its place; offline or on a load error it shows.
 *
 * ⚠️ ORCHESTRATION of chrome, not of data: it reads the scroll host and the cook's name for the condensed title.
 *
 * @pattern Mediator — floats the condensed bar and the create button over the Home surface's one scroller
 */
import { profileEntryOf } from '@commise/features-core';
import { useHomeGreeting } from '@commise/features-core/home';
import { RecipeCreateButton } from '@commise/features-recipes';
import { useHomeCreateEntryYields } from '@commise/features-recipes/widget';
import { CondensedTitleBar } from '@commise/ui/large-title-header';
import { useScrollHost, type ScrollBind } from '@commise/ui/scroll-host';
import type { JSX } from 'react';
import { StyleSheet, View } from 'react-native';

import { HomeWidgetSurface } from '../components/home/HomeWidgetSurface.js';
import { useUserProfile } from '../hooks/useUserProfile.js';
import { ProfileAvatarEntry } from '../navigation/ProfileAvatarEntry.js';

/** Props for {@link HomeScreen}. */
export interface HomeScreenProps {
    /** The bind for the screen's one vertical scroller. */
    readonly scrollBind: ScrollBind;
    /** Navigate to the Recipes tab (the recipe widget's "See all"). */
    readonly onOpenRecipes: () => void;
    /** Push one recipe's detail, from a "Recent recipes" card. */
    readonly onOpenRecipe: (recipeId: string) => void;
    /** Push Profile, from the avatar. */
    readonly onOpenProfile: () => void;
    /** Open the editor (the create button, and the recent block's first run). */
    readonly onCreateRecipe: () => void;
    /** The first run's Paste ingredients: the new editor at Ingredients with its paste sheet open (§7.5.4). */
    readonly onPasteIngredients: () => void;
    /** Go to Discover (the recent block's first run). */
    readonly onFindOnDiscover: () => void;
}

/**
 * The Home tab's root.
 *
 * @param props - The scroller's bind and the navigation intents.
 * @returns The Home surface, with the condensed title bar and the create button over it.
 */
export function HomeScreen({
    scrollBind,
    onOpenRecipes,
    onOpenRecipe,
    onOpenProfile,
    onCreateRecipe,
    onPasteIngredients,
    onFindOnDiscover,
}: HomeScreenProps): JSX.Element {
    const { condensed } = useScrollHost();
    const { title: greeting } = useHomeGreeting(profileEntryOf(useUserProfile()).name);
    // The library's state, from the cache: the floating button yields while the recent recipes load, and on the first run
    // whose own start buttons take its place (§3.4). Offline or on a load error it shows.
    const createEntryYields = useHomeCreateEntryYields();

    return (
        <View style={styles.container}>
            <HomeWidgetSurface
                scrollBind={scrollBind}
                headerAction={{ kind: 'avatar', avatar: <ProfileAvatarEntry onPress={onOpenProfile} /> }}
                onSeeAllRecipes={onOpenRecipes}
                onSelectRecipe={onOpenRecipe}
                onCreateRecipe={onCreateRecipe}
                onPasteIngredients={onPasteIngredients}
                onFindOnDiscover={onFindOnDiscover}
            />
            <CondensedTitleBar title={greeting} surfaceShown={condensed} titleShown={condensed} />
            {/* One tap opens the empty editor (build spec §3.4, slice 8); paste lives in its Ingredients section. */}
            <RecipeCreateButton onCreateRecipe={onCreateRecipe} yielded={createEntryYields} />
        </View>
    );
}

const styles = StyleSheet.create({
    // Transparent so the root `AppCanvas` wash shows through (issue #145).
    container: { flex: 1, backgroundColor: 'transparent' },
});
