/**
 * The native navigation spine (ADR-0056; `docs/architecture/uiOverhaulBlueprint.md` A6; `buildSpec.md` §3.1, §3.5,
 * §3.7), with React Navigation 7 really running under react-native-web. The screens are stubbed — each has its own
 * suite — down to the callbacks the routes wire, so what is asserted is the NAVIGATION:
 *
 * - four tabs (Home, Recipes, Discover, You) and no "Soon" tab; switching tabs keeps each tab's stack; a second tap on
 *   the active tab pops to root;
 * - Profile is the ROOT of the You tab's own `profile` stack (owner ruling 2026-11-11, N3: it is no longer pushed from
 *   an avatar), and Data sources is pushed from it onto that stack (A-026: a page with Back to Profile, not a modal over
 *   it); a second tap on You pops back to Profile;
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
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { renderWithProviders } from '@commise/test-utils';
import { useBackIntercept } from '@commise/ui/back-intercept';
import { installHardwareBackHandler, type HardwareBackHandle } from '@commise/ui/testing/hardware-back';

vi.mock('@sentry/react-native', () => ({ captureException: vi.fn() }));
// A device with a status bar: the shell's ScreenFrame pads this much at the top of every tab screen.
vi.mock('react-native-safe-area-context', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));
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
            onCreateRecipe: () => void;
        }) => {
            const { show } = useSnackbar();

            return stub('Home screen', {
                'See all': props.onOpenRecipes,
                'Open Lamb': () => props.onOpenRecipe('lamb'),
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
        refusalArrived?: boolean;
        finishRefused?: boolean;
        onFinishRefusalSeen?: () => void;
    }) => {
        // §6.4: the real screen reports an arrived claim once its body has mounted; the route keeps it and clears the param.
        useEffect(() => {
            if (props.refusalArrived === true) {
                props.onFinishRefusalSeen?.();
            }
        }, [props, props.refusalArrived, props.onFinishRefusalSeen]);

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
                {props.finishRefused === true ? <Text>{`Refusal kept for ${props.recipeId}`}</Text> : null}
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
    ProfileScreen: (props: { onOpenDataSources: () => void; onOpenYourFoods: () => void }) =>
        stub('Profile screen', {
            'Open data sources': props.onOpenDataSources,
            'Open your foods': props.onOpenYourFoods,
        }),
}));
vi.mock('@commise/features-recipes/food-page/mobile', () => ({
    YourFoodsScreen: (props: { back: { label: string; onPress: () => void } }) =>
        stub('Your foods screen', { [props.back.label]: props.back.onPress }),
}));
// The page itself has its own suite; here it is the callback the route wires, and the back control's name.
vi.mock('@commise/features-recipes/data-sources/mobile', () => ({
    DataSourcesPushedScreen: (props: { back: { label: string; parent: string; onPress: () => void } }) =>
        stub('Data sources screen', {
            [props.back.label]: props.back.onPress,
            [`Parent ${props.back.parent}`]: undefined,
        }),
}));
// Slice 7: one editor screen for create and edit; the stubs keep their old names so the flows below read the same.
vi.mock('../../src/screens/RecipeEditorScreen.js', () => ({
    RecipeEditorScreen: (props: {
        recipeId?: string;
        section?: string;
        openPaste?: boolean;
        onFinished: (id: string, finish: { outcome: string; privateRefused: string | undefined }) => void;
        onClose: () => void;
    }) =>
        props.recipeId === undefined
            ? stub(props.openPaste === true ? `Create wizard, pasting at ${props.section ?? 'top'}` : 'Create wizard', {
                  Publish: () => props.onFinished('fresh', { outcome: 'firstPublish', privateRefused: undefined }),
                  'Publish, Private refused': () =>
                      props.onFinished('fresh', { outcome: 'firstPublish', privateRefused: 'final' }),
                  Cancel: props.onClose,
              })
            : stub(`Edit ${props.recipeId}`, {
                  'Cancel edit': props.onClose,
                  'Save changes': () =>
                      props.onFinished(props.recipeId ?? '', { outcome: 'changesSaved', privateRefused: undefined }),
                  'Save changes, Private refused': () =>
                      props.onFinished(props.recipeId ?? '', { outcome: 'changesSaved', privateRefused: 'premium' }),
              }),
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

const tabBar = () => screen.queryByRole('tablist', { name: 'Tabs' });
const tab = (name: string) => within(tabBar() as HTMLElement).getByRole('tab', { name });
/** The tabs' accessible names: the You tab's disc holds the cook's initials, so `textContent` is not the name. */
const tabNames = (): (string | null)[] =>
    within(tabBar() as HTMLElement)
        .getAllByRole('tab')
        .map((node) => node.getAttribute('aria-label'));
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const showing = (name: string) => screen.queryByRole('heading', { name }) !== null;

describe('the tabs', () => {
    it('starts on Home, with exactly Home, Recipes, Discover and You and no "Soon" tab', () => {
        renderRoot();

        expect(showing('Home screen')).toBe(true);
        expect(tabNames()).toEqual(['Home', 'Recipes', 'Discover', 'You']);
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

describe('Profile, the You tab’s root', () => {
    // REWRITTEN for the You tab (owner ruling 2026-11-11, N3): Profile used to be pushed onto the CURRENT tab from an
    // avatar and left with Back. It is the root of its own stack now, so it has no way back and the tab is how you leave.
    it('opens as the root of the You tab, selected, with the tab bar kept and no way back', () => {
        renderRoot();

        fireEvent.click(tab('You'));

        expect(showing('Profile screen')).toBe(true);
        expect(tab('You').getAttribute('aria-selected')).toBe('true');
        expect(tab('Home').getAttribute('aria-selected')).toBe('false');
        expect(tabBar()).not.toBeNull();
        expect(screen.queryByRole('button', { name: /^(Leave profile|Back)/u })).toBeNull();
    });

    // A-026: Data sources used to open as a full-screen modal with ×, hiding the tab bar. It is a pushed page now, on
    // the profile stack.
    it('pushes Data sources from Profile onto the You stack as a page with Back to Profile, keeping the tab bar', () => {
        renderRoot();
        fireEvent.click(tab('You'));

        press('Open data sources');

        expect(showing('Data sources screen')).toBe(true);
        expect(tabBar()).not.toBeNull();
        expect(tab('You').getAttribute('aria-selected')).toBe('true');
        expect(screen.getByRole('button', { name: 'Back to Profile' })).toBeTruthy();
    });

    it('pops Data sources back to Profile, which stays the root of the You tab', () => {
        renderRoot();
        fireEvent.click(tab('You'));
        press('Open data sources');

        press('Back to Profile');

        expect(showing('Data sources screen')).toBe(false);
        expect(showing('Profile screen')).toBe(true);
        expect(tab('You').getAttribute('aria-selected')).toBe('true');
    });

    it('pushes Your foods from Profile onto the You stack too', () => {
        renderRoot();
        fireEvent.click(tab('You'));

        press('Open your foods');

        expect(showing('Your foods screen')).toBe(true);
        expect(tab('You').getAttribute('aria-selected')).toBe('true');
    });

    it('pops the You stack to Profile on a second tap of You', async () => {
        renderRoot();
        fireEvent.click(tab('You'));
        press('Open data sources');
        expect(showing('Data sources screen')).toBe(true);

        fireEvent.click(tab('You'));
        await act(async () => {
            await new Promise((resolve) => requestAnimationFrame(resolve));
        });

        expect(showing('Profile screen')).toBe(true);
        expect(showing('Data sources screen')).toBe(false);
    });

    it('keeps the You stack when the cook switches away and back', () => {
        renderRoot();
        fireEvent.click(tab('You'));
        press('Open data sources');

        fireEvent.click(tab('Home'));
        expect(showing('Home screen')).toBe(true);
        fireEvent.click(tab('You'));

        expect(showing('Data sources screen')).toBe(true);
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

    /**
     * E8 (build spec §7.8): the snackbar host sits above the stack, so a route can say how the editor finished after it
     * has left, and the message is on screen over the recipe the cook lands on.
     */
    it('⛔ says "Recipe published." over the new recipe, once the editor has gone', () => {
        renderRoot();

        press('New recipe');
        press('Publish');

        expect(showing('Detail fresh')).toBe(true);
        expect(screen.getByText('Recipe published.')).toBeTruthy();
    });

    it('says "Changes saved." after Save changes, over the recipe the cook was editing', () => {
        renderRoot();

        fireEvent.click(tab('Recipes'));
        press('Open Pasta');
        press('Save a copy');
        press('Save changes');

        expect(screen.getByText('Changes saved.')).toBeTruthy();
    });

    /**
     * REWRITTEN (buildSpec §6.4, plan 2026-10-14-009 T3): the snackbar used to say "This recipe is public. Your other
     * changes are saved, but…" in place of "Changes saved.". It says only the outcome now. The refusal rides to the recipe
     * page as a route param, the page keeps it once its body has mounted, and the param is cleared so a return to the same
     * stack entry does not speak it again.
     */
    it('⛔ keeps the snackbar to "Changes saved." and hands the refusal to the recipe page, which keeps it once', () => {
        renderRoot();

        fireEvent.click(tab('Recipes'));
        press('Open Pasta');
        press('Save a copy');
        press('Save changes, Private refused');

        expect(screen.getByText('Changes saved.')).toBeTruthy();
        expect(screen.queryByText(/Your other changes are saved/u)).toBeNull();
        expect(screen.getByText('Refusal kept for pasta-copy')).toBeTruthy();
        // The same stack entry took the param: Back leaves the copy's detail for the one beneath, not for a second copy.
        press('Back');
        expect(showing('Detail pasta')).toBe(true);
    });

    it('⛔ hands a refusal from the CREATE route to the new recipe`s page too', () => {
        renderRoot();

        press('New recipe');
        press('Publish, Private refused');

        expect(screen.getByText('Recipe published.')).toBeTruthy();
        expect(screen.getByText('Refusal kept for fresh')).toBeTruthy();
    });

    it('hands the recipe page no refusal after a plain save', () => {
        renderRoot();

        fireEvent.click(tab('Recipes'));
        press('Open Pasta');
        press('Save a copy');
        press('Save changes');

        expect(screen.queryByText(/Refusal kept/u)).toBeNull();
    });

    it('says nothing for a plain ×: nothing was published or saved', () => {
        renderRoot();

        press('New recipe');
        press('Cancel');

        expect(screen.queryByText('Recipe published.')).toBeNull();
        expect(screen.queryByText('Changes saved.')).toBeNull();
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

/**
 * The precondition the Recipes search band relies on (designer, 2026-11-02): the band behind the pinned field starts at the
 * TOP OF THE LIST FRAME, so the frame must sit inside ScreenFrame's top safe-area padding. If a screen ever starts at y=0
 * the band would start under the status bar, and the top inset has to be added to it for real; this test fails first.
 */
describe('the Recipes roots sit below the status bar', () => {
    /** Whether some ancestor pads its top by the inset: the shell's ScreenFrame. */
    const belowStatusBar = (node: HTMLElement): boolean => {
        for (let up = node.parentElement; up !== null; up = up.parentElement) {
            if (up.style.paddingTop === '47px') {
                return true;
            }
        }

        return false;
    };

    it('puts My recipes inside the top safe-area padding', () => {
        renderRoot();

        fireEvent.click(tab('Recipes'));

        expect(belowStatusBar(screen.getByRole('heading', { name: 'My recipes list' }))).toBe(true);
    });

    it('puts Collections inside it too', () => {
        renderRoot();

        fireEvent.click(tab('Recipes'));
        press('Collections segment');

        expect(belowStatusBar(screen.getByRole('heading', { name: 'Collections list' }))).toBe(true);
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
        expect(screen.getByText('Something went wrong.')).toBeTruthy();

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
