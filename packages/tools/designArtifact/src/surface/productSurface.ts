/**
 * @module surface/productSurface — the files OUTSIDE `@commise/ui` that the artifact exports: product components
 * from the feature packages, the app chrome of each platform, and the hooks previews need.
 *
 * This is a registry, not discovery, on purpose. The feature packages hold hundreds of components that need
 * routers, query clients and an authenticated user; only these render from props alone, so adding one is a
 * decision, made here. `__tests__/productSurface.test.ts` fails when a registered file moves.
 *
 * @pattern Registry — a typed table of what is published; discovery covers `@commise/ui` and composes with it.
 */
import { join } from 'node:path';

import { COMMISE_ROOT, PACKAGE_ROOT } from '../config.js';

/** A registered file and the name it must export. */
export interface RegisteredFile {
    readonly name: string;
    readonly file: string;
}

/** Registered files per platform. */
export interface PlatformFiles {
    readonly web: readonly RegisteredFile[];
    readonly native: readonly RegisteredFile[];
}

const FEATURES = join(COMMISE_ROOT, 'features');

/** Product components: each is `<dir>/<name>.tsx` on web and `<dir>/<name>.native.tsx` on native. */
const PRODUCT_COMPONENTS = [
    { name: 'RecipeCard', dir: 'recipes/src/card' },
    { name: 'RecipeDiscoveryCard', dir: 'recipes/src/discovery' },
    { name: 'RecentRecipeGrid', dir: 'recipes/src/components' },
    { name: 'RecipeHero', dir: 'recipes/src/detail' },
    { name: 'NutritionFigure', dir: 'recipes/src/detail' },
    { name: 'ProfileRow', dir: 'account/src/profile' },
    { name: 'ProfileGroup', dir: 'account/src/profile' },
    { name: 'IngredientRow', dir: 'recipes/src/form' },
    { name: 'EditorHeader', dir: 'recipes/src/editor' },
    { name: 'EditorSection', dir: 'recipes/src/editor' },
    { name: 'EditorActionBar', dir: 'recipes/src/editor' },
    { name: 'PublishLine', dir: 'recipes/src/editor' },
] as const;

/** The product components of the feature packages. */
export const PRODUCT_SURFACE: PlatformFiles = {
    web: PRODUCT_COMPONENTS.map(({ name, dir }) => ({ name, file: join(FEATURES, dir, `${name}.tsx`) })),
    native: PRODUCT_COMPONENTS.map(({ name, dir }) => ({ name, file: join(FEATURES, dir, `${name}.native.tsx`) })),
};

/**
 * The app chrome the screens place around a page: the web sidebar and tab bar, and the mobile tab bar. The mobile
 * app keeps its tab bar in a plain `.tsx` file because it exists only on native.
 */
export const CHROME_SURFACE: PlatformFiles = {
    web: [
        { name: 'HomeSidebar', file: join(COMMISE_ROOT, 'web/src/components/home/chrome/HomeSidebar.tsx') },
        { name: 'HomeTabBar', file: join(COMMISE_ROOT, 'web/src/components/home/chrome/HomeTabBar.tsx') },
    ],
    native: [{ name: 'HomeTabBar', file: join(COMMISE_ROOT, 'mobile/src/components/home/chrome/HomeTabBar.tsx') }],
};

/**
 * Hooks a preview needs beside the components. `SnackbarHost` is only useful with a way to raise a snackbar, and
 * the file is shared by both platforms (the context is platform-neutral).
 */
export const SURFACE_HOOKS: readonly RegisteredFile[] = [
    { name: 'useSnackbar', file: join(COMMISE_ROOT, 'ui/src/snackbar/useSnackbar.ts') },
];

/**
 * Product values a card reads. A typed card must give a component its real props, and the ingredient row takes three
 * product message sets (hundreds of sentences that a card must not copy, or they drift) and a branded line key that
 * only the product's own factory can mint. A card cannot import product values (`compileCard` refuses it), so they
 * are bundled once, on both surfaces, beside the components. These files hold no platform code.
 */
export const SURFACE_VALUES: readonly RegisteredFile[] = [
    { name: 'offlineNoticeMessages', file: join(FEATURES, 'core/src/offline/messages.ts') },
    { name: 'recipeFormMessages', file: join(FEATURES, 'recipes/src/form/messages.ts') },
    { name: 'recipeMessages', file: join(FEATURES, 'recipes/src/messages.ts') },
    { name: 'seedLineKey', file: join(FEATURES, 'recipes/src/form/lineKey.ts') },
];

/**
 * Components that exist only in the artifact. The canvas boards mount them on the native surface: a safe-area
 * provider to place a screen inside an iPhone's insets, and a scroll host whose children are plain markup (a board
 * cannot pass a render-prop child). Each is exported by name from its shim, so no other export of the shim file
 * leaks onto the surface.
 */
export const SHIM_SURFACE: PlatformFiles = {
    web: [],
    native: [
        { name: 'SafeAreaProvider', file: join(PACKAGE_ROOT, 'src/shims/safeAreaContext.tsx') },
        { name: 'ScrollFrame', file: join(PACKAGE_ROOT, 'src/shims/scrollFrame.tsx') },
    ],
};
