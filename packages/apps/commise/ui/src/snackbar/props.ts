/**
 * @module @commise/ui/snackbar — the shared contract of the design-system snackbar (`docs/architecture/
 * uiOverhaulBlueprint.md` Part B; `docs/design/uiOverhaul/buildSpec.md` §1.11, `UndoSnackbar`): one short message at
 * a time near the foot of the screen, with at most one action (Undo), that commits itself when it times out.
 *
 * A screen asks for one through `useSnackbar().show(...)`; the host mounted once per app (`SnackbarHost`) owns the
 * timer, the placement above the bottom chrome and the one-at-a-time rule; `UndoSnackbar` draws it.
 *
 * - A new snackbar COMMITS the one it replaces: the old one's `onTimeout` runs before the new one shows, so an undo
 *   window is never silently lost.
 * - The timer pauses while the pointer is over the snackbar or focus is inside it (SC 2.2.1); on native, while a
 *   screen reader is running, it does not run at all.
 * - It is a polite `status` and never takes focus.
 */
import type { ReactNode } from 'react';

/** The snackbar's one action. */
export interface SnackbarAction {
    /** The localised verb ("Undo"). */
    readonly label: string;
    /** Run when the action is pressed. The snackbar then closes WITHOUT committing. */
    readonly onAction: () => void;
}

/** What a screen asks a snackbar to say and do. */
export interface SnackbarInput {
    /** The localised message, at most two lines. */
    readonly message: string;
    /** The one action, if any. */
    readonly action?: SnackbarAction;
    /** Run once when the snackbar commits: it timed out, or a newer one replaced it. */
    readonly onTimeout?: () => void;
    /** How long it stays, in ms, while not paused. Defaults to {@link DEFAULT_SNACKBAR_MS}. */
    readonly durationMs?: number;
}

/** What `useSnackbar` hands a screen. */
export interface SnackbarApi {
    /** Show a snackbar, committing the one it replaces. */
    readonly show: (input: SnackbarInput) => void;
}

/** The cross-platform `SnackbarHost` contract. */
export interface SnackbarHostProps {
    /** The app the host serves. */
    readonly children: ReactNode;
}

/** The cross-platform `UndoSnackbar` contract: what the host draws for the snackbar on screen. */
export interface UndoSnackbarProps {
    readonly message: string;
    readonly action?: SnackbarAction;
    /** The pointer or focus entered the snackbar: its timer should stop. */
    readonly onPause: () => void;
    /** The pointer or focus left the snackbar: its timer should run on. */
    readonly onResume: () => void;
}

/** A snackbar's life when nothing pauses it (§1.11). */
export const DEFAULT_SNACKBAR_MS = 6000;

/** The gap between a snackbar and the bottom chrome (§1.11). */
export const SNACKBAR_GAP = 16;
