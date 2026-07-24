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
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';

import { mobileMessages } from '../i18n/messages.js';
import { CollectionDetailScreen } from './CollectionDetailScreen.js';
import { CollectionFormScreen } from './CollectionFormScreen.js';
import { CollectionRecipePickerScreen } from './CollectionRecipePickerScreen.js';
import { CollectionsScreen } from './CollectionsScreen.js';
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
    | { readonly id: 'edit'; readonly recipeId: string }
    | { readonly id: 'versions'; readonly recipeId: string }
    | { readonly id: 'collectionDetail'; readonly collectionId: string }
    | { readonly id: 'collectionAddRecipe'; readonly collectionId: string }
    | { readonly id: 'collectionCreate' }
    | { readonly id: 'collectionRename'; readonly collectionId: string; readonly name: string };

const TAB_IDS: readonly TabId[] = ['list', 'discovery', 'collections'];

const isTab = (surface: Surface): surface is Surface & { readonly id: TabId } =>
    (TAB_IDS as readonly string[]).includes(surface.id);

/** The persistent tab bar shown on the three top-level destinations. */
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
            {TAB_IDS.map((tab) => {
                const selected = tab === current;

                return (
                    <Pressable
                        key={tab}
                        accessibilityRole="tab"
                        accessibilityLabel={labels[tab]}
                        accessibilityState={{ selected }}
                        onPress={() => onSelect(tab)}
                        style={[styles.tab, selected && styles.tabSelected]}
                    >
                        <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>{labels[tab]}</Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

/**
 * The recipes surface — a stack of screens starting at the "my recipes" list.
 *
 * @returns The current screen, under the tab bar when it is a top-level destination.
 */
export function RecipesScreen(): JSX.Element {
    const insets = useSafeAreaInsets();
    const [stack, setStack] = useState<readonly Surface[]>([{ id: 'list' }]);

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
    container: { flex: 1, backgroundColor: palette.sand },
    tabBar: {
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: 16,
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(178, 190, 195, 0.3)',
    },
    tab: { paddingVertical: 8, paddingHorizontal: 4, borderBottomWidth: 2, borderBottomColor: 'transparent' },
    tabSelected: { borderBottomColor: palette.seafoam },
    tabLabel: { fontSize: 15, fontWeight: '500', color: palette.slate },
    tabLabelSelected: { color: palette.seafoam, fontWeight: '600' },
});
