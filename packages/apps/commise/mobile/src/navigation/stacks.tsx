/**
 * @module navigation/stacks — one native stack per tab (ADR-0056; `docs/design/uiOverhaul/buildSpec.md` §3.1, §3.7).
 * Each stack registers its own root and the same pushed screens, so a recipe, a collection or Profile opens on the tab
 * the cook is in, and switching tabs keeps each tab's history. The route components here ADAPT a route's params and
 * the navigator's intents to each screen's existing callback props, so no screen knows it is routed.
 *
 * The navigation rules the hand-made `RecipesScreen` stack carried are kept, each at its new home:
 * - Paste ingredients opens the new editor at Ingredients with its Paste a list sheet open (slice 8; the paste and
 *   review screens are retired, so there is no spent paste left in a stack to land on);
 * - a new recipe opens its detail on the Recipes tab with the list beneath it, so Back lands on the list;
 * - deleting a recipe or a collection returns to the tab's root.
 *
 * ORCHESTRATION: each route component binds a screen to the navigator; the screens themselves stay unaware of it.
 *
 * @pattern Adapter — route params and navigator intents → each screen's callback props
 */
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { useBottomTabBarHeight, type BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import { BottomEdgeProvider } from '@commise/ui/layout';
import type { JSX } from 'react';

import { CollectionDetailScreen } from '../screens/CollectionDetailScreen.js';
import { CollectionsScreen } from '../screens/CollectionsScreen.js';
import { HomeScreen } from '../screens/HomeScreen.js';
import { ProfileScreen } from '../screens/profile.js';
import { RecipeDetailScreen } from '../screens/RecipeDetailScreen.js';
import { RecipeDiscoveryScreen } from '../screens/RecipeDiscoveryScreen.js';
import { RecipeListScreen } from '../screens/RecipeListScreen.js';
import { RecipeVersionsScreen } from '../screens/RecipeVersionsScreen.js';
import type { RecipesSegment, RootStackParamList, TabParamList, TabRoute, TabStackParamList } from './routes.js';
import { ProfileAvatarEntry } from './ProfileAvatarEntry.js';
import { ScreenBoundary } from './ScreenBoundary.js';
import { ScreenFrame } from './ScreenFrame.js';
import { TabRootScreen } from './TabRootScreen.js';

/** A tab stack screen's props: its own stack, inside a tab, inside the root stack — so it can reach all three. */
type TabScreenProps<Name extends keyof TabStackParamList> = CompositeScreenProps<
    NativeStackScreenProps<TabStackParamList, Name>,
    CompositeScreenProps<BottomTabScreenProps<TabParamList>, NativeStackScreenProps<RootStackParamList>>
>;

/**
 * ONE stack navigator definition, rendered once per tab: each render is its own navigator instance with its own history
 * (React Navigation keys a navigator's state by where it is rendered), so the three tabs share the screen set and never
 * share a history.
 */
const TabStackNavigator = createNativeStackNavigator<TabStackParamList>();

/** A recipe's detail, on whichever tab pushed it. */
function RecipeDetailRoute({ navigation, route }: TabScreenProps<'RecipeDetail'>): JSX.Element {
    return (
        <RecipeDetailScreen
            recipeId={route.params.recipeId}
            onBack={() => navigation.goBack()}
            onEdit={(recipeId) => navigation.navigate('RecipeEdit', { recipeId })}
            onViewVersions={(recipeId) => navigation.push('RecipeVersions', { recipeId })}
            onDeleted={() => navigation.popToTop()}
            onCloned={(copyId) => {
                // FR-005b: a copy is published only after a substantive edit, so it opens in the editor, with its own
                // detail beneath so leaving the editor lands on the copy, and Back from there on the original.
                navigation.push('RecipeDetail', { recipeId: copyId });
                navigation.navigate('RecipeEdit', { recipeId: copyId });
            }}
        />
    );
}

/** A recipe's version history. */
function RecipeVersionsRoute({ navigation, route }: TabScreenProps<'RecipeVersions'>): JSX.Element {
    return <RecipeVersionsScreen recipeId={route.params.recipeId} onBack={() => navigation.goBack()} />;
}

/** A collection's detail. */
function CollectionDetailRoute({ navigation, route }: TabScreenProps<'CollectionDetail'>): JSX.Element {
    const { collectionId } = route.params;

    return (
        <CollectionDetailScreen
            collectionId={collectionId}
            onSelectRecipe={(recipeId) => navigation.push('RecipeDetail', { recipeId })}
            onCreateRecipe={() => navigation.navigate('RecipeCreate')}
            // Back to the list, as on web: Back alone would land a deleted copy on the original it was saved from.
            onDeleted={() => navigation.popToTop()}
            onCloned={(id) => navigation.push('CollectionDetail', { collectionId: id })}
            onViewSource={(id) => navigation.push('CollectionDetail', { collectionId: id })}
            onBack={() => navigation.goBack()}
        />
    );
}

/** Profile, pushed from the avatar onto the current tab. */
function ProfileRoute({ navigation }: TabScreenProps<'Profile'>): JSX.Element {
    return <ProfileScreen onBack={() => navigation.goBack()} />;
}

/** Home, the Home tab's root. */
function HomeRoute({ navigation }: TabScreenProps<'HomeRoot'>): JSX.Element {
    return (
        <TabRootScreen>
            {(bind) => (
                <HomeScreen
                    scrollBind={bind}
                    onOpenRecipes={() => navigation.navigate('recipes')}
                    onOpenRecipe={(recipeId) => navigation.push('RecipeDetail', { recipeId })}
                    onOpenProfile={() => navigation.push('Profile')}
                    onCreateRecipe={() => navigation.navigate('RecipeCreate')}
                    onPasteIngredients={() =>
                        navigation.navigate('RecipeCreate', { section: 'ingredients', paste: true })
                    }
                    onFindOnDiscover={() => navigation.navigate('discover')}
                />
            )}
        </TabRootScreen>
    );
}

/** The segments have no URLs on native; the shared control still names a place for each. */
const NATIVE_SEGMENT_HREF = { mine: 'recipes', collections: 'collections' } as const;

/**
 * The Recipes tab's root: My recipes · Collections, ONE screen with a `segment` param (blueprint A6). Each screen draws
 * the segments under its large title (`buildSpec.md` §4.3, §5.1); choosing one only sets the param.
 */
function RecipesRoute({ navigation, route }: TabScreenProps<'RecipesRoot'>): JSX.Element {
    const segment: RecipesSegment = route.params?.segment ?? 'mine';
    const segments = {
        current: segment,
        href: NATIVE_SEGMENT_HREF,
        onSelect: (next: RecipesSegment) => navigation.setParams({ segment: next }),
    };
    const headerAction = {
        kind: 'avatar',
        avatar: <ProfileAvatarEntry onPress={() => navigation.push('Profile')} />,
    } as const;

    return (
        <TabRootScreen>
            {(bind) =>
                segment === 'mine' ? (
                    <RecipeListScreen
                        scrollBind={bind}
                        segments={segments}
                        headerAction={headerAction}
                        onSelectRecipe={(recipeId) => navigation.push('RecipeDetail', { recipeId })}
                        onCreateRecipe={() => navigation.navigate('RecipeCreate')}
                        onPasteIngredients={() =>
                            navigation.navigate('RecipeCreate', { section: 'ingredients', paste: true })
                        }
                    />
                ) : (
                    <CollectionsScreen
                        scrollBind={bind}
                        segments={segments}
                        headerAction={headerAction}
                        onSelect={(collectionId) => navigation.push('CollectionDetail', { collectionId })}
                        onCreateRecipe={() => navigation.navigate('RecipeCreate')}
                    />
                )
            }
        </TabRootScreen>
    );
}

/** Discover, a tab of its own (it used to be a tab inside Recipes). */
function DiscoverRoute({ navigation, route }: TabScreenProps<'DiscoverRoot'>): JSX.Element {
    const tags = route.params?.tags;

    return (
        <TabRootScreen>
            {(bind) => (
                <RecipeDiscoveryScreen
                    scrollBind={bind}
                    // A tag deep-link opens Discover pre-filtered by it. Keyed so a new tag re-seeds the filters.
                    key={tags?.join('\n') ?? ''}
                    initialFilters={tags === undefined ? undefined : { tags: [...tags] }}
                    onSelectRecipe={(recipeId) => navigation.push('RecipeDetail', { recipeId })}
                    // The Save a copy snackbar's Edit: a copy opens in the editor (FR-005b), as from a recipe's page.
                    onEditRecipe={(recipeId) => navigation.navigate('RecipeEdit', { recipeId })}
                    headerAction={{
                        kind: 'avatar',
                        avatar: <ProfileAvatarEntry onPress={() => navigation.push('Profile')} />,
                    }}
                />
            )}
        </TabRootScreen>
    );
}

/** What every tab stack shares: transparent scenes, no library header, and the safe-area frame. */
const STACK_OPTIONS = { headerShown: false, contentStyle: { backgroundColor: 'transparent' } } as const;

/**
 * Wraps every tab screen: the safe-area frame (the tab bar owns the bottom), the bar's height for popups, and the
 * screen's own crash boundary.
 */
function TabScreenLayout({
    route,
    children,
}: {
    readonly route: { readonly name: string };
    readonly children: JSX.Element;
}): JSX.Element {
    return (
        <BottomEdgeProvider value={useBottomTabBarHeight()}>
            <ScreenFrame ownsBottom={false}>
                <ScreenBoundary atHome={route.name === 'HomeRoot'}>{children}</ScreenBoundary>
            </ScreenFrame>
        </BottomEdgeProvider>
    );
}

/**
 * A tab's root screen.
 *
 * @param tab - The tab.
 * @returns Its root, for the stack to register first.
 */
function rootScreenOf(tab: TabRoute): JSX.Element {
    switch (tab) {
        case 'home':
            return <TabStackNavigator.Screen name="HomeRoot" component={HomeRoute} />;
        case 'recipes':
            return <TabStackNavigator.Screen name="RecipesRoot" component={RecipesRoute} />;
        case 'discover':
            return <TabStackNavigator.Screen name="DiscoverRoot" component={DiscoverRoute} />;
    }
}

/** Props for {@link TabStack}. */
export interface TabStackProps {
    /** The tab this stack belongs to, which decides its root. */
    readonly tab: TabRoute;
}

/**
 * A tab's native stack: its root, then the pushed screens every tab shares.
 *
 * @param props - The tab.
 * @returns The stack navigator.
 */
export function TabStack({ tab }: TabStackProps): JSX.Element {
    return (
        <TabStackNavigator.Navigator
            screenOptions={STACK_OPTIONS} // A component, not the function itself: React Navigation CALLS `screenLayout` inside its own render, so a hook in
            // it (`useBottomTabBarHeight`) would become the navigator's hook and break its hook order as screens push.
            screenLayout={(props) => <TabScreenLayout route={props.route}>{props.children}</TabScreenLayout>}
        >
            {rootScreenOf(tab)}
            <TabStackNavigator.Screen name="RecipeDetail" component={RecipeDetailRoute} />
            <TabStackNavigator.Screen name="RecipeVersions" component={RecipeVersionsRoute} />
            <TabStackNavigator.Screen name="CollectionDetail" component={CollectionDetailRoute} />
            <TabStackNavigator.Screen name="Profile" component={ProfileRoute} />
        </TabStackNavigator.Navigator>
    );
}
