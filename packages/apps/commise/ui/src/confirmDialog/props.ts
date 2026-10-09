/**
 * @module @commise/ui/confirm-dialog — shared, platform-neutral prop contract for the design-system `ConfirmDialog`
 * (house pattern B6). The web (`ConfirmDialog.tsx`, Radix `AlertDialog`) and native (`ConfirmDialog.native.tsx`, the
 * design system's `DialogFrame`) leaves both implement this exact surface.
 *
 * A controlled, presentational confirmation of a DESTRUCTIVE step — discarding unsaved edits, closing an account,
 * deleting a recipe. It owns no state and performs no side effect beyond the two callbacks. Every string is a
 * caller-supplied prop (no i18n import here).
 *
 * The buttons are verbs, never "OK" and "Cancel" (`docs/design/uiOverhaul/buildSpec.md` §1.11, §6.5): `confirm` names
 * the destructive act and wears the filled `danger` tone, `keep` names what the person keeps and is where focus opens.
 * Every caller confirms something destructive, so the old `destructive` flag is gone: a non-destructive confirmation
 * has no use in this product, and the flag let a caller draw the danger fill on a safe action by mistake.
 *
 * ⚠️ `busyLabel` is not in the blueprint's contract. It says the request is in flight in words, politely, because a
 * spinner alone is not announced; `RecipeDeleteDialog` carried that status before it adopted this primitive.
 * ⚠️ While busy, Keep stays able to close the dialog: a stuck request must stay dismissible (a recorded decision of
 * `RecipeDeleteDialog`, kept against spec §6.5's "both lock").
 */
import type { IconName } from '../icon/props.js';

/** The destructive action: its verb and its glyph. */
export interface ConfirmAction {
    readonly label: string;
    readonly icon: IconName;
}

/** The safe action: its verb, and a glyph if not the default `x`. */
export interface KeepAction {
    readonly label: string;
    readonly icon?: IconName;
}

/** The cross-platform `ConfirmDialog` contract. */
export interface ConfirmDialogProps {
    /** Whether the dialog is shown. When `false` the component renders nothing. */
    readonly open: boolean;
    /** The dialog's accessible title (also the visible heading). */
    readonly title: string;
    /** The dialog's body copy, explaining the consequence of confirming. */
    readonly body: string;
    /** The destructive action ("Delete recipe"). */
    readonly confirm: ConfirmAction;
    /** The safe action ("Keep recipe"); focus opens on it. */
    readonly keep: KeepAction;
    /** Invoked when the person confirms. */
    readonly onConfirm: () => void;
    /** Invoked when the person keeps (also an Escape on web, and the Back button on Android). */
    readonly onKeep: () => void;
    /** The confirmed request is in flight: the confirm spins and cannot fire again. */
    readonly busy?: boolean;
    /** Said politely while busy ("Deleting…"). */
    readonly busyLabel?: string;
    /** Why the last confirmed request failed, shown inside the dialog. Hidden while a retry is in flight. */
    readonly error?: string;
}
