/**
 * Home screen (mobile): the Home tab's root (`docs/design/uiOverhaul/buildSpec.md` §4.2). It composes the
 * {@link HomeWidgetSurface} — whose scroller takes the screen's `ScrollHost` bind and whose first child is the large
 * title — and floats two things over it: the condensed title bar, once the greeting scrolls under the top, and the
 * floating "New recipe" button, a sibling after the scroller so it stays put.
 *
 * Interim (§13, slice 3): the button opens today's two-item create menu (Write → the wizard, Paste → the paste flow)
 * until slice 8 makes it one tap. ⚠️ Home's first run should hide it (§3.4); whether the cook has any recipe is known
 * only inside the recipe widget today, so it shows in first run too.
 *
 * ⚠️ ORCHESTRATION of chrome, not of data: it reads the scroll host and the cook's name for the condensed title.
 *
 * @pattern Mediator — floats the condensed bar and the create button over the Home surface's one scroller
 */
import { profileEntryOf } from '@commise/features-core';
import { RecipeCreateButton } from '@commise/features-recipes';
import { useLibraryEmpty } from '@commise/features-recipes/hooks';
import { CondensedTitleBar } from '@commise/ui/large-title-header';
import { useScrollHost, type ScrollBind } from '@commise/ui/scroll-host';
import type { JSX } from 'react';
import { recipeServiceKeys } from '@kitchensink/recipe-service-client';
import { StyleSheet, View } from 'react-native';

import { HomeWidgetSurface } from '../components/home/HomeWidgetSurface.js';
import { RECENT_RECIPE_LIMIT } from '../components/home/RecipeWidgetSlot.js';
import { useHomeGreeting } from '../components/home/HomeGreeting.js';
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
    const greeting = useHomeGreeting(profileEntryOf(useUserProfile()).name);
    // The recent-recipes read the widget makes, read from the cache: a settled page of no recipes is Home's first run,
    // whose own start buttons take the floating button's place (§3.4).
    const firstRun = useLibraryEmpty(recipeServiceKeys.recipeList({ pageSize: RECENT_RECIPE_LIMIT }));

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
            <CondensedTitleBar title={greeting} visible={condensed} />
            {/* One tap opens the empty editor (build spec §3.4, slice 8); paste lives in its Ingredients section. */}
            <RecipeCreateButton onCreateRecipe={onCreateRecipe} firstRun={firstRun} />
        </View>
    );
}

const styles = StyleSheet.create({
    // Transparent so the root `AppCanvas` wash shows through (issue #145).
    container: { flex: 1, backgroundColor: 'transparent' },
});
