/**
 * @module navigation/tasks — the focused tasks, on the ROOT stack above the tabs, so the tab bar hides by construction
 * (`docs/design/uiOverhaul/buildSpec.md` §3.5): the one-page editor (create, edit; slice 7). Paste a list lives inside
 * its Ingredients section since slice 8. Each route ADAPTS its params and the navigator's intents to the screen's
 * callback props.
 *
 * ORCHESTRATION: each route binds a screen to the navigator; the screens stay unaware of it.
 *
 * The editor keeps the iOS edge swipe and Android Back: it saves continuously, so leaving loses nothing (§7.12).
 *
 * @pattern Adapter — route params and navigator intents → each screen's callback props
 */
import type { NativeStackScreenProps, createNativeStackNavigator } from '@react-navigation/native-stack';
import { useCallback, type JSX } from 'react';

import { RecipeEditorScreen } from '../screens/RecipeEditorScreen.js';
import type { RootStackParamList } from './routes.js';

/** A root stack screen's props. */
type TaskProps<Name extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, Name>;

/**
 * The editor's leave subscription on this route: React Navigation's `beforeRemove`. ONE function for the route's life
 * (the screen's `navigation` object is stable), so the editor's subscription is made once, not on every render.
 */
function useLeaveSubscription(
    navigation: TaskProps<'RecipeCreate'>['navigation'] | TaskProps<'RecipeEdit'>['navigation'],
): (listener: () => void) => () => void {
    return useCallback((listener: () => void) => navigation.addListener('beforeRemove', listener), [navigation]);
}

/**
 * Create a recipe in the one-page editor (slice 7). Once published, its detail opens on the Recipes tab with the list
 * BENEATH it (`initial: false`), so Back lands on the list rather than dead-ending.
 */
function RecipeCreateRoute({ navigation, route }: TaskProps<'RecipeCreate'>): JSX.Element {
    // `pop: true`: back to My recipes, never a push over it. A discarded recipe's detail under the list would otherwise
    // stay in the Recipes stack, and Back from My recipes would land on a recipe that no longer exists.
    const toRecipes = (): void =>
        navigation.popTo('Tabs', { screen: 'recipes', params: { screen: 'RecipesRoot', pop: true } });
    const subscribeToLeave = useLeaveSubscription(navigation);

    return (
        <RecipeEditorScreen
            {...(route.params?.section === undefined ? {} : { section: route.params.section })}
            openPaste={route.params?.paste === true}
            onFinished={(recipeId) =>
                navigation.popTo('Tabs', {
                    screen: 'recipes',
                    params: { screen: 'RecipeDetail', params: { recipeId }, initial: false },
                })
            }
            onClose={() => navigation.goBack()}
            onDiscarded={toRecipes}
            subscribeToLeave={subscribeToLeave}
        />
    );
}

/** Edit a recipe in the one-page editor; publishing, saving changes or closing returns to where it was opened. */
function RecipeEditRoute({ navigation, route }: TaskProps<'RecipeEdit'>): JSX.Element {
    const subscribeToLeave = useLeaveSubscription(navigation);

    return (
        <RecipeEditorScreen
            recipeId={route.params.recipeId}
            {...(route.params.section === undefined ? {} : { section: route.params.section })}
            onFinished={() => navigation.goBack()}
            onClose={() => navigation.goBack()}
            onDiscarded={() =>
                navigation.popTo('Tabs', { screen: 'recipes', params: { screen: 'RecipesRoot', pop: true } })
            }
            subscribeToLeave={subscribeToLeave}
        />
    );
}

/** The root stack navigator the tasks register on. */
type RootStack = ReturnType<typeof createNativeStackNavigator<RootStackParamList>>;

/**
 * The focused-task screens, for the root stack to register.
 *
 * @param Stack - The root stack navigator.
 * @returns The task screens.
 */
export function taskScreens(Stack: RootStack): JSX.Element {
    return (
        <>
            <Stack.Screen name="RecipeCreate" component={RecipeCreateRoute} />
            <Stack.Screen name="RecipeEdit" component={RecipeEditRoute} />
        </>
    );
}
