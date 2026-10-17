/**
 * @module cards/cardComponents — the typed registry of components a card may mount. A card's `render` receives
 * the namespace narrowed to the names it declared in `uses`, and each member is the REAL public component type, so
 * a wrong prop fails `tsc` in the card file.
 *
 * One registry serves both namespaces: the web and native leaves implement the same props contract
 * (`docs/CODING_STANDARDS.md` §14), and the package export is the platform-neutral module that types it.
 *
 * ⚠️ A component no package exports (an internal part such as the editor's header, or the app chrome, whose web and
 * mobile apps export nothing) is typed {@link NameOnly}: its card is checked by name against the discovered surface,
 * not by props. Exporting such a component from its package is what upgrades its card to a typed one.
 *
 * The native column is typed by {@link NativeCardComponents}: the same table, with the entries whose native props
 * differ from the web ones replaced. A card that mounts such a component gives `renderNative` (see `cardSpec.ts`)
 * and passes native-shaped props there.
 *
 * @pattern Registry — a typed table of the components cards can use.
 */
import type { ComponentType, Ref } from 'react';

import type { ProfileGroup, ProfileRow } from '@commise/features-account/profile';
import type { RecentRecipeGrid, RecipeCard, RecipeDiscoveryCard } from '@commise/features-recipes';
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

/** A component with no package export: mountable, checked by name only. */
export type NameOnly = ComponentType<Record<string, unknown>>;

/** Component name to its real component type. */
export interface CardComponents {
    readonly ActionMenu: typeof ActionMenu;
    readonly Avatar: typeof Avatar;
    readonly AvatarDisc: typeof AvatarDisc;
    readonly BackToTop: typeof BackToTop;
    readonly BottomChromeFrame: typeof BottomChromeFrame;
    readonly BottomEdgeProvider: typeof BottomEdgeProvider;
    readonly BottomSheetPanel: NameOnly;
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
    readonly EditorActionBar: NameOnly;
    readonly EditorHeader: NameOnly;
    readonly EditorSection: NameOnly;
    readonly EnterTransition: typeof EnterTransition;
    readonly FabFace: NameOnly;
    readonly FieldLabel: typeof FieldLabel;
    readonly FullScreenSheet: typeof FullScreenSheet;
    readonly GradientSurface: typeof GradientSurface;
    readonly HeroButton: typeof HeroButton;
    readonly HomeSidebar: NameOnly;
    readonly HomeTabBar: NameOnly;
    readonly Icon: typeof Icon;
    readonly IngredientRow: NameOnly;
    readonly Input: typeof Input;
    readonly KeepAwakeToggle: typeof KeepAwakeToggle;
    readonly KeyboardAvoider: typeof KeyboardAvoider;
    readonly LargeTitleHeader: typeof LargeTitleHeader;
    readonly LiveRegion: typeof LiveRegion;
    readonly LoadMoreControl: typeof LoadMoreControl;
    readonly LoadingNotice: typeof LoadingNotice;
    readonly Modal: typeof Modal;
    readonly NutritionFigure: NameOnly;
    readonly OfflineReadSlot: typeof OfflineReadSlot;
    readonly PendingBar: typeof PendingBar;
    readonly PhotoControl: typeof PhotoControl;
    readonly Popover: typeof Popover;
    readonly PressScale: typeof PressScale;
    readonly ProfileGroup: typeof ProfileGroup;
    readonly ProfileRow: typeof ProfileRow;
    readonly PublishLine: NameOnly;
    readonly RecentRecipeGrid: typeof RecentRecipeGrid;
    readonly RecipeCard: typeof RecipeCard;
    readonly RecipeCover: typeof RecipeCover;
    readonly RecipeDiscoveryCard: typeof RecipeDiscoveryCard;
    readonly RecipeHero: NameOnly;
    readonly RefreshNotice: typeof RefreshNotice;
    readonly RevealSpacer: typeof RevealSpacer;
    readonly RouteAction: typeof RouteAction;
    readonly ScrollHost: typeof ScrollHost;
    readonly SearchField: typeof SearchField;
    readonly SectionIndex: typeof SectionIndex;
    readonly SectionSwitch: typeof SectionSwitch;
    readonly SegmentedControl: typeof SegmentedControl;
    readonly Sheet: typeof Sheet;
    readonly SheetPanel: NameOnly;
    readonly SnackbarHost: typeof SnackbarHost;
    readonly Spinner: NameOnly;
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
 * - `EditorHeader`, `EditorActionBar` and `IngredientRow` are in no package export, so they stay {@link NameOnly}: a
 *   native card is checked by name only. Exporting their native props (`EditorHeaderProps`, `EditorActionBarProps` in
 *   `editor/frameProps.ts`, `IngredientRowProps` in `IngredientRow.native.tsx`) from the package entry is what upgrades
 *   them, and the entry here is then the one line to change.
 */
export interface NativeDivergentComponents {
    readonly HeroButton: ComponentType<HeroButtonProps & { readonly ref?: Ref<unknown> }>;
    readonly EditorHeader: NameOnly;
    readonly EditorActionBar: NameOnly;
    readonly IngredientRow: NameOnly;
}

/** Component name to its component type as the NATIVE column mounts it. */
export type NativeCardComponents = Omit<CardComponents, keyof NativeDivergentComponents> & NativeDivergentComponents;

/** What `renderNative` receives: the declared components, typed against the native leaves. */
export type NativeCardUi<Used extends CardComponentName> = Pick<NativeCardComponents, Used>;
