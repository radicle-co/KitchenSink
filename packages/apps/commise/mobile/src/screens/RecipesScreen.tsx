/**
 * Recipes surface (mobile). The lightweight state-machine navigator for the recipe slice (US1 + US2): it
 * owns a small navigation STACK of screen descriptors (a discriminated union carrying `recipeId`,
 * `collectionId`, and rename `name` params) and renders the current screen, composing the per-screen
 * containers that each drive a `@commise/features-recipes` native block from a
 * `@kitchensink/recipe-service-client` hook. No navigation library — the stack is a single piece of local
 * state; every screen already exposes the right seams (selection/back/done callbacks) so they drop straight
 * into a real stack navigator when one is introduced app-wide.
 *
 * The three top-level destinations (my recipes, discover, collections) are TABS rendered under a persistent
 * tab bar; selecting a tab resets the stack to that root. Everything else (detail, create, edit, version
 * history, collection detail/create/rename) is a full-screen push with its own back/cancel affordance.
 */
import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RecipeSourceTab } from '@commise/features-recipes/source-tab/mobile';
import { useMessages } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';

import { mobileMessages } from '../i18n/messages.js';
import { CollectionDetailScreen } from './CollectionDetailScreen.js';
import { CollectionFormScreen } from './CollectionFormScreen.js';
import { CollectionRecipePickerScreen } from './CollectionRecipePickerScreen.js';
import { CollectionsScreen } from './CollectionsScreen.js';
import { ParseIngredientsScreen } from './ParseIngredientsScreen.js';
import { ParseJobReviewScreen } from './ParseJobReviewScreen.js';
import { RecipeCreateScreen } from './RecipeCreateScreen.js';
import { RecipeDetailScreen } from './RecipeDetailScreen.js';
import { RecipeDiscoveryScreen } from './RecipeDiscoveryScreen.js';
import { RecipeEditScreen } from './RecipeEditScreen.js';
import { RecipeListScreen } from './RecipeListScreen.js';
import { RecipeVersionsScreen } from './RecipeVersionsScreen.js';

/** A top-level tab (rendered under the persistent tab bar; selecting one resets the stack to its root). */
type TabId = 'list' | 'discovery' | 'collections';

/** One entry on the navigation stack — the screen to render plus its params. */
type Surface =
    | { readonly id: 'list' }
    | { readonly id: 'discovery'; readonly tags?: readonly string[] }
    | { readonly id: 'collections' }
    | { readonly id: 'detail'; readonly recipeId: string }
    | { readonly id: 'create' }
    // Plan U9's two parse surfaces. TWO members, not one carrying an optional id: pasting and reviewing are
    // different screens with different props, and an optional `jobId` would make "review with no job"
    // representable — a state the review screen cannot render and nothing would stop a caller pushing.
    | { readonly id: 'parse' }
    | { readonly id: 'parseReview'; readonly jobId: string }
    | { readonly id: 'edit'; readonly recipeId: string }
    | { readonly id: 'versions'; readonly recipeId: string }
    | { readonly id: 'collectionDetail'; readonly collectionId: string }
    | { readonly id: 'collectionAddRecipe'; readonly collectionId: string }
    | { readonly id: 'collectionCreate' }
    | { readonly id: 'collectionRename'; readonly collectionId: string; readonly name: string };

const TAB_IDS: readonly TabId[] = ['list', 'discovery', 'collections'];

const isTab = (surface: Surface): surface is Surface & { readonly id: TabId } =>
    (TAB_IDS as readonly string[]).includes(surface.id);

/**
 * The persistent tab bar shown on the three top-level destinations — mobile's recipe-SOURCE switcher, and the
 * one a phone user actually touches (the shared list/discovery views take no `tab` of their own here, because
 * this bar already spans them).
 *
 * Each destination is the shared {@link RecipeSourceTab}, so the affordance — the resting fill + hairline that
 * make an unselected tab visible WITHOUT a hover state, the seafoam-underline/`ocean-dark`-label palette rule,
 * the 44pt target — is defined once, in `@commise/features-recipes`, and is identical to the web strip's. It
 * used to be transcribed here as a local StyleSheet whose unselected tab was a transparent border over no
 * fill: bare text, indistinguishable from a heading, with nothing for a thumb to recognise as a control.
 */
function TabBar({
    current,
    onSelect,
}: {
    readonly current: TabId;
    readonly onSelect: (tab: TabId) => void;
}): JSX.Element {
    const { recipesNav: t } = useMessages(mobileMessages);
    const labels: Record<TabId, string> = { list: t.myRecipes, discovery: t.discover, collections: t.collections };

    return (
        <View accessibilityRole="tablist" style={styles.tabBar}>
            {TAB_IDS.map((tab) => (
                <RecipeSourceTab
                    key={tab}
                    label={labels[tab]}
                    selected={tab === current}
                    onPress={() => onSelect(tab)}
                />
            ))}
        </View>
    );
}

/** Props for {@link RecipesScreen}. */
export interface RecipesScreenProps {
    /**
     * Enter the surface DIRECTLY at this recipe's detail instead of the list — how a Home "Recent recipes"
     * card tap arrives here. The list is kept BENEATH the detail on the seeded stack (rather than the detail
     * being the root) so Back lands on the recipe list instead of dead-ending, matching what
     * `RecipeCreateScreen`'s `onCreated` already does.
     *
     * Read at mount only, which is correct because the surface is unmounted whenever the root navigator is
     * showing Home; `AppRoot` additionally keys this screen by the id so a different recipe always remounts.
     */
    readonly initialRecipeId?: string;
}

/**
 * The recipes surface — a stack of screens starting at the "my recipes" list.
 *
 * @param props - Optional `initialRecipeId` to open straight into a recipe's detail.
 * @returns The current screen, under the tab bar when it is a top-level destination.
 */
export function RecipesScreen({ initialRecipeId }: RecipesScreenProps = {}): JSX.Element {
    const insets = useSafeAreaInsets();
    const [stack, setStack] = useState<readonly Surface[]>(
        initialRecipeId === undefined
            ? [{ id: 'list' }]
            : [{ id: 'list' }, { id: 'detail', recipeId: initialRecipeId }],
    );

    const nav = useMemo(
        () => ({
            push: (surface: Surface) => setStack((s) => [...s, surface]),
            back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
            selectTab: (tab: TabId) => setStack([{ id: tab }]),
            reset: (surfaces: readonly Surface[]) => setStack(surfaces),
        }),
        [],
    );

    const current = stack[stack.length - 1] ?? { id: 'list' };
    const screen = renderSurface(current, nav);

    // Hardware back must navigate WITHIN the app's surface stack, not exit it: without this handler RN's
    // default pops the single Android activity, so a back press (or a stray back event) from any pushed
    // surface — recipe detail, editor, a collection — drops the user straight to the launcher. Return `true`
    // to consume the event while there's a surface to pop; return `false` on the root so the OS default
    // (leave the app) still applies from a top-level tab.
    useEffect(() => {
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            if (stack.length > 1) {
                nav.back();

                return true;
            }

            return false;
        });

        return () => subscription.remove();
    }, [stack.length, nav]);

    // Apply the top safe-area inset so the tab bar + screen headings clear the status bar (without it the
    // top row renders UNDER the status bar — a visual defect, and the occluded nodes drop out of the
    // accessibility hierarchy, which also makes them invisible to screen readers and to Maestro E2E).
    // Apply BOTH safe-area insets. The top clears the status bar; the bottom clears the gesture/navigation
    // bar. Without the bottom inset, the foot of a scroll (e.g. the recipe detail's owner actions) renders
    // under the 3-button nav bar — the left-aligned "Delete recipe" action overlaps the nav bar's back
    // button, so a tap there fires BACK (popping the detail) instead of opening the confirm.
    //
    // ⚠️ `paddingBottom` is now load-bearing for a control in ANOTHER package. The recipe list's create dial
    // (`@commise/features-recipes`'s `SpeedDial.native.tsx`) pins its FAB inside this padded box while
    // opening its menu in a modal WINDOW, which spans the whole display and inherits none of this — so the
    // menu re-adds `insets.bottom` itself to line up. Drop or change this padding when a real navigator
    // lands and the FAB slides under the gesture bar while its menu stays put, opening a visible gap.
    const containerStyle = [styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }];

    if (isTab(current)) {
        return (
            <View style={containerStyle}>
                <TabBar current={current.id} onSelect={nav.selectTab} />
                {screen}
            </View>
        );
    }

    return <View style={containerStyle}>{screen}</View>;
}

/** Navigation intents handed to each screen (a tiny stack API — no library). */
interface Nav {
    readonly push: (surface: Surface) => void;
    readonly back: () => void;
    readonly selectTab: (tab: TabId) => void;
    readonly reset: (surfaces: readonly Surface[]) => void;
}

/** Map the current surface descriptor to its screen container, wiring navigation to the stack API. */
function renderSurface(surface: Surface, nav: Nav): JSX.Element {
    switch (surface.id) {
        case 'list':
            return (
                <RecipeListScreen
                    onSelectRecipe={(recipeId) => nav.push({ id: 'detail', recipeId })}
                    onCreateRecipe={() => nav.push({ id: 'create' })}
                    onPasteIngredients={() => nav.push({ id: 'parse' })}
                />
            );
        case 'discovery':
            return (
                <RecipeDiscoveryScreen
                    // A tag deep-link (D6) resets the stack to this tab carrying the tag as a preset filter.
                    initialFilters={surface.tags ? { tags: [...surface.tags] } : undefined}
                    onSelectRecipe={(recipeId) => nav.push({ id: 'detail', recipeId })}
                />
            );
        case 'collections':
            return (
                <CollectionsScreen
                    onSelect={(collectionId) => nav.push({ id: 'collectionDetail', collectionId })}
                    onCreate={() => nav.push({ id: 'collectionCreate' })}
                />
            );
        case 'detail':
            return (
                <RecipeDetailScreen
                    recipeId={surface.recipeId}
                    onBack={nav.back}
                    onEdit={(recipeId) => nav.push({ id: 'edit', recipeId })}
                    onViewVersions={(recipeId) => nav.push({ id: 'versions', recipeId })}
                    onDeleted={() => nav.selectTab('list')}
                    onCloned={(recipeId) => nav.push({ id: 'detail', recipeId })}
                    // D6: reset to the discovery tab pre-filtered by the tapped tag (the visibility-scoped search).
                    onFilterByTag={(tag) => nav.reset([{ id: 'discovery', tags: [tag] }])}
                />
            );
        case 'create':
            return (
                <RecipeCreateScreen
                    onCreated={(recipeId) => nav.reset([{ id: 'list' }, { id: 'detail', recipeId }])}
                    onCancel={nav.back}
                />
            );
        case 'parse':
            // ⛔ `reset`, not `push`: the paste form is spent once its job exists, and leaving it on the
            // stack means a Back press lands on text that would create a SECOND job from the same paste.
            // The web container replaces its route for exactly this reason.
            return (
                <ParseIngredientsScreen
                    onCreated={(jobId) => nav.reset([{ id: 'list' }, { id: 'parseReview', jobId }])}
                    onBack={nav.back}
                />
            );
        case 'parseReview':
            return (
                <ParseJobReviewScreen
                    jobId={surface.jobId}
                    // ⛔ THE LIST STAYS BENEATH IT. `nav.reset([{ id: 'parse' }])` left a stack of ONE, and
                    // the hardware-back handler above returns `false` at the root — so on Android a cook who
                    // pressed "Start over" and then Back was dropped straight out of the app. Same rule the
                    // seeded detail stack follows, and the same one `onCreated` one line up already applies.
                    onStartOver={() => nav.reset([{ id: 'list' }, { id: 'parse' }])}
                    onBack={nav.back}
                />
            );
        case 'edit':
            return <RecipeEditScreen recipeId={surface.recipeId} onSaved={() => nav.back()} onCancel={nav.back} />;
        case 'versions':
            return <RecipeVersionsScreen recipeId={surface.recipeId} onBack={nav.back} />;
        case 'collectionDetail':
            return (
                <CollectionDetailScreen
                    collectionId={surface.collectionId}
                    onSelectRecipe={(recipeId) => nav.push({ id: 'detail', recipeId })}
                    onAddRecipe={() => nav.push({ id: 'collectionAddRecipe', collectionId: surface.collectionId })}
                    onRename={(name) => nav.push({ id: 'collectionRename', collectionId: surface.collectionId, name })}
                    onDeleted={() => nav.selectTab('collections')}
                    onCloned={(collectionId) => nav.push({ id: 'collectionDetail', collectionId })}
                    onViewSource={(collectionId) => nav.push({ id: 'collectionDetail', collectionId })}
                    onBack={nav.back}
                />
            );
        case 'collectionAddRecipe':
            return (
                <CollectionRecipePickerScreen
                    collectionId={surface.collectionId}
                    onCreateRecipe={() => nav.push({ id: 'create' })}
                    onDone={nav.back}
                />
            );
        case 'collectionCreate':
            return <CollectionFormScreen mode="create" onDone={nav.back} onCancel={nav.back} />;
        case 'collectionRename':
            return (
                <CollectionFormScreen
                    mode="rename"
                    collectionId={surface.collectionId}
                    initialName={surface.name}
                    onDone={nav.back}
                    onCancel={nav.back}
                />
            );
    }
}

const styles = StyleSheet.create({
    // Transparent so the root `AppCanvas` beach-glow gradient shows through (issue #145). An opaque
    // fill here occludes the whole canvas and restores the flat page the wireframes never had.
    container: { flex: 1, backgroundColor: 'transparent' },
    tabBar: {
        flexDirection: 'row',
        gap: nativeTokens.spacing[2],
        paddingHorizontal: nativeTokens.spacing[4],
        paddingBottom: nativeTokens.spacing[2],
        borderBottomWidth: 1,
        borderBottomColor: nativeTokens.borderSubtle,
    },
    // Each tab's own surface (target, fill, hairline, underline, label colour) belongs to the shared
    // `RecipeSourceTab` — one definition for this bar, the shared list strip and the web strip.
});
