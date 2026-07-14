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
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useMessages } from '@commise/i18n/react';

import { mobileMessages } from '../i18n/messages.js';
import { CollectionDetailScreen } from './CollectionDetailScreen.js';
import { CollectionFormScreen } from './CollectionFormScreen.js';
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
    | { readonly id: 'discovery' }
    | { readonly id: 'collections' }
    | { readonly id: 'detail'; readonly recipeId: string }
    | { readonly id: 'create' }
    | { readonly id: 'edit'; readonly recipeId: string }
    | { readonly id: 'versions'; readonly recipeId: string }
    | { readonly id: 'collectionDetail'; readonly collectionId: string }
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
            {TAB_IDS.map((tab) => (
                <Pressable
                    key={tab}
                    accessibilityRole="tab"
                    accessibilityLabel={labels[tab]}
                    accessibilityState={{ selected: tab === current }}
                    onPress={() => onSelect(tab)}
                >
                    <Text>{labels[tab]}</Text>
                </Pressable>
            ))}
        </View>
    );
}

/**
 * The recipes surface — a stack of screens starting at the "my recipes" list.
 *
 * @returns The current screen, under the tab bar when it is a top-level destination.
 */
export function RecipesScreen(): JSX.Element {
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

    if (isTab(current)) {
        return (
            <View style={styles.container}>
                <TabBar current={current.id} onSelect={nav.selectTab} />
                {screen}
            </View>
        );
    }

    return screen;
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
            return <RecipeDiscoveryScreen onSelectRecipe={(recipeId) => nav.push({ id: 'detail', recipeId })} />;
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
                    onRename={(name) => nav.push({ id: 'collectionRename', collectionId: surface.collectionId, name })}
                    onDeleted={() => nav.selectTab('collections')}
                    onBack={nav.back}
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
    container: { flex: 1 },
    tabBar: { flexDirection: 'row' },
});
