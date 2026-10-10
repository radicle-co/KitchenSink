/**
 * The native navigation spine (ADR-0056; `docs/architecture/uiOverhaulBlueprint.md` A6; `buildSpec.md` §3.1, §3.5,
 * §3.7), with React Navigation 7 really running under react-native-web. The screens are stubbed — each has its own
 * suite — down to the callbacks the routes wire, so what is asserted is the NAVIGATION:
 *
 * - three tabs and no "Soon" tab; switching tabs keeps each tab's stack; a second tap on the active tab pops to root;
 * - Profile is pushed onto the CURRENT tab from the avatar;
 * - a focused task sits above the tabs, so the tab bar hides by construction;
 * - the rules the deleted hand-made `RecipesScreen` stack carried, each at its new home (a new recipe opens with the
 *   list beneath it; a delete returns to the tab's root), and Paste ingredients opening the editor at Ingredients with
 *   its paste sheet (slice 8, which retired the paste and review screens);
 * - hardware Back: an open sheet gets first refusal; a press nothing claims is DECLINED by our provider so React
 *   Navigation's own handler takes it (that handler is native-only, so its pops are proven on device by Maestro);
 * - the root crash boundary, and the snackbar above the measured tab bar.
 *
 * Rewritten for slice 3 from `AppRoot.shell`, `RecipesScreen` and `RecipesScreen.backGuard`, which tested the
 * hand-made stacks this replaces. The wizard's discard guard on Back is the editor screens' own (`RecipeCreateScreen`
 * suite); here only the order that lets it answer first is pinned.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { renderWithProviders } from '@commise/test-utils';
import { useBackIntercept } from '@commise/ui/back-intercept';
import { installHardwareBackHandler, type HardwareBackHandle } from '@commise/ui/testing/hardware-back';

vi.mock('@sentry/react-native', () => ({ captureException: vi.fn() }));
vi.mock('../../src/hooks/useUserProfile.js', () => ({
    useUserProfile: () => ({ isError: false, data: { user: { displayName: 'Eliza Mendes' } } }),
}));

const crash = vi.hoisted(() => ({ discover: false }));
/** Which tab-root screens were handed their scroll host's bind (blueprint A7), by stub name. */
const bound = vi.hoisted(() => new Set<string>());

/** A stub screen: its name, and one button per callback it is handed. */
function stub(name: string, callbacks: Record<string, (() => void) | undefined>) {
    return (
        <View>
            <Text accessibilityRole="header">{name}</Text>
            {Object.entries(callbacks).map(([label, onPress]) =>
                onPress === undefined ? null : (
                    <Text key={label} accessibilityRole="button" onPress={onPress}>
                        {label}
                    </Text>
                ),
            )}
        </View>
    );
}

vi.mock('../../src/screens/HomeScreen.js', async () => {
    const { useSnackbar } = await import('@commise/ui/snackbar');

    return {
        HomeScreen: (props: {
            onOpenRecipes: () => void;
            onOpenRecipe: (id: string) => void;
            onOpenProfile: () => void;
            onCreateRecipe: () => void;
        }) => {
            const { show } = useSnackbar();

            return stub('Home screen', {
                'See all': props.onOpenRecipes,
                'Open Lamb': () => props.onOpenRecipe('lamb'),
                Avatar: props.onOpenProfile,
                'New recipe': props.onCreateRecipe,
                Remove: () => show({ message: 'Removed Pasta' }),
            });
        },
    };
});
/** The segments a Recipes-root screen is handed, as the stub draws them. */
interface StubSegments {
    readonly segments?: { readonly onSelect: (segment: 'mine' | 'collections') => void };
}

vi.mock('../../src/screens/RecipeListScreen.js', () => ({
    RecipeListScreen: (
        props: StubSegments & {
            onSelectRecipe: (id: string) => void;
            onPasteIngredients?: () => void;
            scrollBind?: unknown;
        },
    ) => {
        if (props.scrollBind !== undefined) {
            bound.add('My recipes list');
        }

        return stub('My recipes list', {
            'Open Pasta': () => props.onSelectRecipe('pasta'),
            Paste: props.onPasteIngredients,
            'Collections segment': () => props.segments?.onSelect('collections'),
        });
    },
}));
vi.mock('../../src/screens/CollectionsScreen.js', () => ({
    CollectionsScreen: (props: StubSegments & { onSelect: (id: string) => void; scrollBind?: unknown }) => {
        if (props.scrollBind !== undefined) {
            bound.add('Collections list');
        }

        return stub('Collections list', {
            'Open Weeknight': () => props.onSelect('weeknight'),
            'My recipes segment': () => props.segments?.onSelect('mine'),
        });
    },
}));
vi.mock('../../src/screens/RecipeDiscoveryScreen.js', () => ({
    RecipeDiscoveryScreen: (props: { scrollBind?: unknown }) => {
        if (crash.discover) {
            throw new Error('discover crashed');
        }

        if (props.scrollBind !== undefined) {
            bound.add('Discover screen');
        }

        return stub('Discover screen', {});
    },
}));
vi.mock('../../src/screens/RecipeDetailScreen.js', () => ({
    RecipeDetailScreen: (props: {
        recipeId: string;
        onBack?: () => void;
        onDeleted?: () => void;
        onCloned?: (copyId: string) => void;
    }) => {
        // The detail opens a sheet that claims hardware Back while it is open, as the real ⋯ menu does.
        const [sheetOpen, setSheetOpen] = useState(false);

        useBackIntercept(() => {
            if (!sheetOpen) {
                return false;
            }

            setSheetOpen(false);

            return true;
        });

        return (
            <View>
                {stub(`Detail ${props.recipeId}`, {
                    Back: props.onBack,
                    Delete: props.onDeleted,
                    'Save a copy': () => props.onCloned?.(`${props.recipeId}-copy`),
                    'Open sheet': () => setSheetOpen(true),
                })}
                {sheetOpen ? <Text>Sheet open</Text> : null}
            </View>
        );
    },
}));
vi.mock('../../src/screens/CollectionDetailScreen.js', () => ({
    CollectionDetailScreen: (props: { collectionId: string; onDeleted: () => void; onCloned: (id: string) => void }) =>
        stub(`Collection ${props.collectionId}`, {
            'Delete collection': props.onDeleted,
            'Save a copy of the collection': () => props.onCloned(`${props.collectionId}-copy`),
        }),
}));
vi.mock('../../src/screens/RecipeVersionsScreen.js', () => ({ RecipeVersionsScreen: () => stub('Versions', {}) }));
vi.mock('../../src/screens/profile.js', () => ({
    ProfileScreen: (props: { onBack: () => void }) => stub('Profile screen', { 'Leave profile': props.onBack }),
}));
// Slice 7: one editor screen for create and edit; the stubs keep their old names so the flows below read the same.
vi.mock('../../src/screens/RecipeEditorScreen.js', () => ({
    RecipeEditorScreen: (props: {
        recipeId?: string;
        section?: string;
        openPaste?: boolean;
        onFinished: (id: string) => void;
        onClose: () => void;
    }) =>
        props.recipeId === undefined
            ? stub(props.openPaste === true ? `Create wizard, pasting at ${props.section ?? 'top'}` : 'Create wizard', {
                  Publish: () => props.onFinished('fresh'),
                  Cancel: props.onClose,
              })
            : stub(`Edit ${props.recipeId}`, { 'Cancel edit': props.onClose }),
}));
vi.mock('../../src/screens/CollectionFormScreen.js', () => ({
    CollectionFormScreen: () => stub('Collection form', {}),
}));
vi.mock('../../src/screens/CollectionRecipePickerScreen.js', () => ({
    CollectionRecipePickerScreen: () => stub('Picker', {}),
}));

const { AppRoot } = await import('../../src/screens/AppRoot.js');

let back: HardwareBackHandle;

afterEach(() => {
    cleanup();
    back.restore();
    crash.discover = false;
});

function renderRoot(): void {
    back = installHardwareBackHandler();
    renderWithProviders(<AppRoot />);
}

const tabBar = () => screen.queryByRole('tablist', { name: 'Main' });
const tab = (name: string) => within(tabBar() as HTMLElement).getByRole('tab', { name });
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const showing = (name: string) => screen.queryByRole('heading', { name }) !== null;

describe('the tabs', () => {
    it('starts on Home, with exactly Home, Recipes and Discover and no "Soon" tab', () => {
        renderRoot();

        expect(showing('Home screen')).toBe(true);
        expect(
            within(tabBar() as HTMLElement)
                .getAllByRole('tab')
                .map((node) => node.textContent),
        ).toEqual(['Home', 'Recipes', 'Discover']);
        expect(tab('Home').getAttribute('aria-selected')).toBe('true');
    });

    it('switches tabs, marking the selected one', () => {
        renderRoot();

        fireEvent.click(tab('Discover'));

        expect(showing('Discover screen')).toBe(true);
        expect(tab('Discover').getAttribute('aria-selected')).toBe('true');
        expect(tab('Home').getAttribute('aria-selected')).toBe('false');
    });

    it('keeps each tab’s stack when the cook switches away and back', () => {
        renderRoot();

        fireEvent.click(tab('Recipes'));
        press('Open Pasta');
        expect(showing('Detail pasta')).toBe(true);

        fireEvent.click(tab('Home'));
        expect(showing('Home screen')).toBe(true);
        fireEvent.click(tab('Recipes'));

        expect(showing('Detail pasta')).toBe(true);
    });

    it('pops a tab to its root on a second tap of that tab', async () => {
        renderRoot();

        fireEvent.click(tab('Recipes'));
        press('Open Pasta');
        fireEvent.click(tab('Recipes'));
        // The library's stack pops on `tabPress` in the next frame.
        await act(async () => {
            await new Promise((resolve) => requestAnimationFrame(resolve));
        });

        expect(showing('My recipes list')).toBe(true);
    });

    it('keeps the tab bar on a pushed screen (level 3), with the tab still selected', () => {
        renderRoot();

        press('Open Lamb');

        expect(showing('Detail lamb')).toBe(true);
        expect(tab('Home').getAttribute('aria-selected')).toBe('true');
    });

    it('opens Recipes from Home’s "See all"', () => {
        renderRoot();

        press('See all');

        expect(showing('My recipes list')).toBe(true);
        expect(tab('Recipes').getAttribute('aria-selected')).toBe('true');
    });
});

describe('the Recipes segments', () => {
    it('switches My recipes · Collections in place, on one root', () => {
        renderRoot();

        fireEvent.click(tab('Recipes'));
        press('Collections segment');

        expect(showing('Collections list')).toBe(true);
        press('Open Weeknight');
        expect(showing('Collection weeknight')).toBe(true);

        // A deleted collection returns to the list it was opened from.
        press('Delete collection');
        expect(showing('Collections list')).toBe(true);
        press('My recipes segment');
        expect(showing('My recipes list')).toBe(true);
    });
});

describe('Profile, from the avatar', () => {
    // REWRITTEN in slice 9: Profile is the ONE account page now (`AccountSettings` and its route are deleted), so
    // there is no second screen to push from it. What stays: it opens on the CURRENT tab, and Back returns there.
    it('is pushed onto the CURRENT tab’s stack and Back returns to it', () => {
        renderRoot();

        press('Avatar');
        expect(showing('Profile screen')).toBe(true);
        expect(tab('Home').getAttribute('aria-selected')).toBe('true');

        press('Leave profile');
        expect(showing('Profile screen')).toBe(false);
        expect(showing('Home screen')).toBe(true);
    });
});

describe('focused tasks', () => {
    it('sit above the tabs, so the tab bar hides, and return where they were opened', () => {
        renderRoot();

        press('New recipe');
        expect(showing('Create wizard')).toBe(true);
        expect(tabBar()).toBeNull();

        press('Cancel');
        expect(showing('Home screen')).toBe(true);
        expect(tabBar()).not.toBeNull();
    });

    it('open a new recipe on the Recipes tab with the list BENEATH it, so Back lands on the list', () => {
        renderRoot();

        press('New recipe');
        press('Publish');
        expect(showing('Detail fresh')).toBe(true);
        expect(tab('Recipes').getAttribute('aria-selected')).toBe('true');

        press('Back');
        expect(showing('My recipes list')).toBe(true);
    });

    it('Paste ingredients opens the new editor at Ingredients with its paste sheet up, above the tabs (slice 8)', () => {
        renderRoot();

        fireEvent.click(tab('Recipes'));
        press('Paste');
        expect(showing('Create wizard, pasting at ingredients')).toBe(true);
        expect(tabBar()).toBeNull();

        press('Cancel');
        expect(showing('My recipes list')).toBe(true);
    });
});

describe('a deleted recipe', () => {
    it('returns to the tab’s root', () => {
        renderRoot();

        fireEvent.click(tab('Recipes'));
        press('Open Pasta');
        press('Delete');

        expect(showing('My recipes list')).toBe(true);
    });
});

/**
 * A deleted collection lands on the Collections list, as on web (`CollectionDetailContainer`'s delete pushes the list):
 * never on another collection's detail, which is where `goBack` left a deleted copy, over the original it was saved from.
 */
/**
 * Each tab root scrolls inside its own `ScrollHost` (blueprint A7), so its ONE vertical scroller must take the host's
 * bind: without it the floating create button never reads the scroll and the tab's second tap has nothing to move.
 */
describe('the tab roots', () => {
    it("hand My recipes, Collections and Discover their scroll host's bind", () => {
        bound.clear();
        renderRoot();

        fireEvent.click(tab('Recipes'));
        press('Collections segment');
        fireEvent.click(tab('Discover'));

        expect([...bound].sort()).toEqual(['Collections list', 'Discover screen', 'My recipes list']);
    });
});

describe('a deleted collection', () => {
    it('returns to the Collections list, even from a copy pushed over its original', () => {
        renderRoot();

        fireEvent.click(tab('Recipes'));
        press('Collections segment');
        press('Open Weeknight');
        press('Save a copy of the collection');
        expect(showing('Collection weeknight-copy')).toBe(true);

        press('Delete collection');

        expect(showing('Collections list')).toBe(true);
    });
});

/**
 * FR-005b: a clone may not be published until it carries a substantive edit, so the copy opens straight in the editor
 * (slice 6). The copy's own detail sits beneath it, so leaving the editor lands on the copy, and Back from there on
 * the original.
 */
describe('a saved copy', () => {
    it('opens in the editor, over the copy’s detail, over the original', () => {
        renderRoot();

        fireEvent.click(tab('Recipes'));
        press('Open Pasta');
        press('Save a copy');
        expect(showing('Edit pasta-copy')).toBe(true);
        expect(tabBar()).toBeNull();

        press('Cancel edit');
        expect(showing('Detail pasta-copy')).toBe(true);
        press('Back');
        expect(showing('Detail pasta')).toBe(true);
    });
});

describe('hardware Back', () => {
    it('lets an open sheet answer FIRST: it closes the sheet, not the screen', () => {
        renderRoot();

        press('Open Lamb');
        press('Open sheet');
        let handled = false;
        act(() => {
            handled = back.press();
        });

        expect(handled).toBe(true);
        expect(screen.queryByText('Sheet open')).toBeNull();
        expect(showing('Detail lamb')).toBe(true);
    });

    it('declines a press nothing claims, so React Navigation’s own handler pops or leaves the app', () => {
        renderRoot();

        press('Open Lamb');
        let handled = true;
        act(() => {
            handled = back.press();
        });

        expect(handled).toBe(false);
    });

    it('holds exactly one subscription of its own', () => {
        renderRoot();

        expect(back.subscribeCount()).toBe(1);
    });
});

describe('the root crash boundary', () => {
    it('shows the recoverable fallback, and Back to Home lands on Home', () => {
        crash.discover = true;
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        renderRoot();

        fireEvent.click(tab('Discover'));
        expect(screen.getByText('Something went wrong')).toBeTruthy();

        crash.discover = false;
        fireEvent.click(screen.getByRole('button', { name: /home/i }));

        expect(showing('Home screen')).toBe(true);
        spy.mockRestore();
    });
});

describe('the snackbar host', () => {
    it('lets a screen show a snackbar, 16 pt above the measured tab bar', () => {
        renderRoot();

        const frame = tabBar()?.parentElement as (Element & { __reactLayoutHandler?: (event: unknown) => void }) | null;
        act(() => frame?.__reactLayoutHandler?.({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 72 } } }));
        press('Remove');

        const status = screen.getByRole('status');

        expect(status.textContent).toBe('Removed Pasta');
        expect(getComputedStyle(status).bottom).toBe('88px');
    });
});
