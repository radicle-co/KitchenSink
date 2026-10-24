/**
 * @module cards/cardComponents — the typed registry of components a card may mount. A card's `render` receives
 * the namespace narrowed to the names it declared in `uses`, and each member is the REAL component type (a package
 * export, or for an internal its source file, below), so a wrong prop fails `tsc` in the card file. Every card is
 * checked by its props.
 *
 * One registry serves both namespaces where the web and native leaves implement the same props contract
 * (`docs/CODING_STANDARDS.md` §14): the entry is then the platform-neutral type. A component that exists on one
 * platform only is typed from that platform's leaf, and its card shows that platform only.
 *
 * ⚠️ A component no package exports (an internal part such as the editor's header, or the app chrome, whose web and
 * mobile apps export nothing) is typed from its SOURCE FILE, through the type-only `#commise/*` alias in this
 * package's `tsconfig.json`. That is deliberate: a package export is a public contract, and these are internals, so
 * the alternative (exporting them, or depending on `@commise/web` / `@commise/mobile`, whose build is the whole Next /
 * Expo build) costs more than a path. The alias is held to `import type` by `__tests__/commiseTypeOnlyImports.test.ts`,
 * and it points at the files `surface/productSurface.ts` registers, so the type and the bundled file are one fact.
 *
 * The native column is typed by {@link NativeCardComponents}: the same table, with the entries whose native props
 * differ from the web ones replaced. A card that mounts such a component gives `renderNative` (see `cardSpec.ts`)
 * and passes native-shaped props there.
 *
 * @pattern Registry — a typed table of the components cards can use.
 */
import type { ComponentType, Ref } from 'react';

import type { ProfileGroup, ProfileRow } from '@commise/features-account/profile';
import type { offlineNoticeMessages } from '@commise/features-core/offline';
import type {
    RecentRecipeGrid,
    RecipeCard,
    RecipeDiscoveryCard,
    recipeFormMessages,
    recipeMessages,
} from '@commise/features-recipes';
import type { ActionMenu } from '@commise/ui/action-menu';
import type { Avatar, AvatarDisc } from '@commise/ui/avatar';
import type { BackToTop } from '@commise/ui/back-to-top';
import type { Button } from '@commise/ui/button';
import type { CheckBoxGlyph } from '@commise/ui/check-box-glyph';
import type { Chip, ChipRow } from '@commise/ui/chip';
import type { ChromeSurface } from '@commise/ui/chrome-surface';
import type { Combobox } from '@commise/ui/combobox';
import type { ConfirmDialog } from '@commise/ui/confirm-dialog';
import type { CreateFab } from '@commise/ui/create-fab';
import type { DialogFrame } from '@commise/ui/dialog-frame';
import type { DifficultyBadge } from '@commise/ui/difficulty-badge';
import type { DurationField } from '@commise/ui/duration-field';
import type { RevealSpacer } from '@commise/ui/field-reveal';
import type { FullScreenSheet } from '@commise/ui/full-screen-sheet';
import type { HeroButton, HeroButtonProps } from '@commise/ui/hero-button';
import type { HorizontalScroller } from '@commise/ui/horizontal-scroller';
import type { Icon } from '@commise/ui/icon';
import type { FieldLabel, Input, Stepper, TextArea } from '@commise/ui/input';
import type { KeepAwakeToggle } from '@commise/ui/keep-awake';
import type { KeyboardAvoider } from '@commise/ui/keyboard-avoider';
import type { CondensedTitleBar, LargeTitleHeader } from '@commise/ui/large-title-header';
import type { BottomChromeFrame, BottomEdgeProvider } from '@commise/ui/layout';
import type { LiveRegion } from '@commise/ui/live-region';
import type { LoadMoreControl } from '@commise/ui/load-more';
import type { LoadingNotice } from '@commise/ui/loading-notice';
import type { Modal } from '@commise/ui/modal';
import type { EnterTransition } from '@commise/ui/motion';
import type { OfflineReadSlot } from '@commise/ui/offline-notice';
import type { PendingBar } from '@commise/ui/pending-bar';
import type { PhotoControl } from '@commise/ui/photo-control';
import type { Popover } from '@commise/ui/popover';
import type { PressScale } from '@commise/ui/press-scale';
import type { PushedPageFrame } from '@commise/ui/pushed-page';
import type { RecipeCover } from '@commise/ui/recipe-cover';
import type { RefreshNotice } from '@commise/ui/refresh-notice';
import type { RouteAction } from '@commise/ui/route-link';
import type { ScrollHost } from '@commise/ui/scroll-host';
import type { SearchField } from '@commise/ui/search-field';
import type { SectionIndex } from '@commise/ui/section-index';
import type { SectionSwitch } from '@commise/ui/section-switch';
import type { SegmentedControl } from '@commise/ui/segmented-control';
import type { Sheet } from '@commise/ui/sheet';
import type { SnackbarHost, UndoSnackbar } from '@commise/ui/snackbar';
import type { StandIn } from '@commise/ui/stand-in';
import type { StateNotice } from '@commise/ui/state-notice';
import type { StatusBadge } from '@commise/ui/status-badge';
import type { GradientSurface } from '@commise/ui/surface';
import type { SyncNotice, SyncNoticeStack, UnreadableWorkNotice } from '@commise/ui/sync-notice';
import type { TextInput } from '@commise/ui/text-input';
import type { Tooltip } from '@commise/ui/tooltip';
import type { VariantPartsLine } from '@commise/ui/variant-parts-line';

// The internals no package exports, by source path (see the module doc). Web leaves are the plain `.tsx` file; the
// `*Native` names are the `.native.tsx` leaf where its props differ from the web one.
import type { NutritionFigure } from '#commise/features/recipes/src/detail/NutritionFigure';
import type { RecipeHero } from '#commise/features/recipes/src/detail/RecipeHero';
import type { EditorActionBar } from '#commise/features/recipes/src/editor/EditorActionBar';
import type { EditorActionBar as EditorActionBarNative } from '#commise/features/recipes/src/editor/EditorActionBar.native';
import type { EditorHeader } from '#commise/features/recipes/src/editor/EditorHeader';
import type { EditorHeader as EditorHeaderNative } from '#commise/features/recipes/src/editor/EditorHeader.native';
import type { EditorSection } from '#commise/features/recipes/src/editor/EditorSection';
import type { PublishLine } from '#commise/features/recipes/src/editor/PublishLine';
import type { IngredientRow } from '#commise/features/recipes/src/form/IngredientRow';
import type { IngredientRow as IngredientRowNative } from '#commise/features/recipes/src/form/IngredientRow.native';
import type { seedLineKey } from '#commise/features/recipes/src/form/lineKey';
import type { HomeSidebar } from '#commise/web/src/components/home/chrome/HomeSidebar';
import type { HomeTabBar } from '#commise/web/src/components/home/chrome/HomeTabBar';
import type { HomeTabBar as HomeTabBarNative } from '#commise/mobile/src/components/home/chrome/HomeTabBar';
import type { FabFace } from '#commise/ui/src/createFab/FabFace';
import type { BottomSheetPanel } from '#commise/ui/src/sheet/BottomSheetPanel.native';
import type { SheetPanel } from '#commise/ui/src/sheet/SheetPanel';
import type { Spinner } from '#commise/ui/src/spinner/Spinner';

/**
 * Name to the real component type, plus the product values a card may read (the message sets and `seedLineKey`): the
 * surface bundles them (`surface/productSurface.ts` `SURFACE_VALUES`) because a card may not import
 * product values itself.
 */
export interface CardComponents {
    readonly ActionMenu: typeof ActionMenu;
    readonly Avatar: typeof Avatar;
    readonly AvatarDisc: typeof AvatarDisc;
    readonly BackToTop: typeof BackToTop;
    readonly BottomChromeFrame: typeof BottomChromeFrame;
    readonly BottomEdgeProvider: typeof BottomEdgeProvider;
    readonly BottomSheetPanel: typeof BottomSheetPanel;
    readonly Button: typeof Button;
    readonly CheckBoxGlyph: typeof CheckBoxGlyph;
    readonly Chip: typeof Chip;
    readonly ChipRow: typeof ChipRow;
    readonly ChromeSurface: typeof ChromeSurface;
    readonly Combobox: typeof Combobox;
    readonly CondensedTitleBar: typeof CondensedTitleBar;
    readonly ConfirmDialog: typeof ConfirmDialog;
    readonly CreateFab: typeof CreateFab;
    readonly DialogFrame: typeof DialogFrame;
    readonly DifficultyBadge: typeof DifficultyBadge;
    readonly DurationField: typeof DurationField;
    readonly EditorActionBar: typeof EditorActionBar;
    readonly EditorHeader: typeof EditorHeader;
    readonly EditorSection: typeof EditorSection;
    readonly EnterTransition: typeof EnterTransition;
    readonly FabFace: typeof FabFace;
    readonly FieldLabel: typeof FieldLabel;
    readonly FullScreenSheet: typeof FullScreenSheet;
    readonly GradientSurface: typeof GradientSurface;
    readonly HeroButton: typeof HeroButton;
    readonly HomeSidebar: typeof HomeSidebar;
    readonly HomeTabBar: typeof HomeTabBar;
    readonly HorizontalScroller: typeof HorizontalScroller;
    readonly Icon: typeof Icon;
    readonly IngredientRow: typeof IngredientRow;
    readonly Input: typeof Input;
    readonly KeepAwakeToggle: typeof KeepAwakeToggle;
    readonly KeyboardAvoider: typeof KeyboardAvoider;
    readonly LargeTitleHeader: typeof LargeTitleHeader;
    readonly LiveRegion: typeof LiveRegion;
    readonly LoadMoreControl: typeof LoadMoreControl;
    readonly LoadingNotice: typeof LoadingNotice;
    readonly Modal: typeof Modal;
    readonly NutritionFigure: typeof NutritionFigure;
    readonly OfflineReadSlot: typeof OfflineReadSlot;
    readonly PendingBar: typeof PendingBar;
    readonly PhotoControl: typeof PhotoControl;
    readonly Popover: typeof Popover;
    readonly PressScale: typeof PressScale;
    readonly ProfileGroup: typeof ProfileGroup;
    readonly ProfileRow: typeof ProfileRow;
    readonly PublishLine: typeof PublishLine;
    readonly PushedPageFrame: typeof PushedPageFrame;
    readonly RecentRecipeGrid: typeof RecentRecipeGrid;
    readonly RecipeCard: typeof RecipeCard;
    readonly RecipeCover: typeof RecipeCover;
    readonly RecipeDiscoveryCard: typeof RecipeDiscoveryCard;
    readonly RecipeHero: typeof RecipeHero;
    readonly offlineNoticeMessages: typeof offlineNoticeMessages;
    readonly recipeFormMessages: typeof recipeFormMessages;
    readonly recipeMessages: typeof recipeMessages;
    readonly seedLineKey: typeof seedLineKey;
    readonly RefreshNotice: typeof RefreshNotice;
    readonly RevealSpacer: typeof RevealSpacer;
    readonly RouteAction: typeof RouteAction;
    readonly ScrollHost: typeof ScrollHost;
    readonly SearchField: typeof SearchField;
    readonly SectionIndex: typeof SectionIndex;
    readonly SectionSwitch: typeof SectionSwitch;
    readonly SegmentedControl: typeof SegmentedControl;
    readonly Sheet: typeof Sheet;
    readonly SheetPanel: typeof SheetPanel;
    readonly SnackbarHost: typeof SnackbarHost;
    readonly Spinner: typeof Spinner;
    readonly StandIn: typeof StandIn;
    readonly StateNotice: typeof StateNotice;
    readonly StatusBadge: typeof StatusBadge;
    readonly Stepper: typeof Stepper;
    readonly SyncNotice: typeof SyncNotice;
    readonly SyncNoticeStack: typeof SyncNoticeStack;
    readonly TextArea: typeof TextArea;
    readonly TextInput: typeof TextInput;
    readonly Tooltip: typeof Tooltip;
    readonly UndoSnackbar: typeof UndoSnackbar;
    readonly UnreadableWorkNotice: typeof UnreadableWorkNotice;
    readonly VariantPartsLine: typeof VariantPartsLine;
}

/** The names a card may declare in `uses`. */
export type CardComponentName = keyof CardComponents;

/** What `render` receives: the declared components, typed. */
export type CardUi<Used extends CardComponentName> = Pick<CardComponents, Used>;

/**
 * The components whose NATIVE leaf takes props the web leaf does not (or the reverse), so one `render` cannot serve both
 * columns. Found by the component census (`docs/generated/components/findings.json`, rule
 * `cross-platform-props-diverge`). Each entry is the native leaf's own contract where a package export carries it:
 *
 * - `HeroButton` takes `ref` as a plain prop (`HeroButtonNativeProps`, in `HeroButton.native.tsx`, not re-exported by
 *   `@commise/ui/hero-button`), so it is the shared {@link HeroButtonProps} plus that one prop.
 * - `EditorHeader`, `EditorActionBar` and `IngredientRow` take their own native contracts from the `.native.tsx` leaf
 *   (the web header and bar also take the `placeRef` the page measures them by, and the web bar `pinned`; the native
 *   row has `amountColumn`, `onLayout`, `m` and `speak`).
 * - `HomeTabBar` is a different component on each platform: the web bar is a router-driven `nav` of links, the mobile
 *   bar takes `onPress`, the insets and `compact`.
 *
 * `BottomSheetPanel` exists only as a native leaf, so {@link CardComponents} types it from that leaf; its card is a
 * native-only one.
 */
export interface NativeDivergentComponents {
    readonly HeroButton: ComponentType<HeroButtonProps & { readonly ref?: Ref<unknown> }>;
    readonly EditorHeader: typeof EditorHeaderNative;
    readonly EditorActionBar: typeof EditorActionBarNative;
    readonly IngredientRow: typeof IngredientRowNative;
    readonly HomeTabBar: typeof HomeTabBarNative;
}

/** Component name to its component type as the NATIVE column mounts it. */
export type NativeCardComponents = Omit<CardComponents, keyof NativeDivergentComponents> & NativeDivergentComponents;

/** What `renderNative` receives: the declared components, typed against the native leaves. */
export type NativeCardUi<Used extends CardComponentName> = Pick<NativeCardComponents, Used>;
