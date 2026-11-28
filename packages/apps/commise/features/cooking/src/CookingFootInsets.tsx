'use client';

/**
 * @module CookingFootInsets — tells the app's one snackbar host where the cooking foot starts, so a snackbar (the
 * timer's Undo) draws above the dock and Back / Next instead of over them.
 *
 * The cooking route has no AppShell and no column, so the host keeps centring on the viewport; only the bottom changes.
 * The foot is found by its id when it is read and when the watch starts, so no ref is held.
 *
 * Presentational: props → JSX, plus the provider it wraps.
 *
 * @pattern Adapter — the foot's rectangle, as `PopupInsetsProvider` reads page chrome
 */
import { PopupInsetsProvider, resizeWatchOf, type PopupInsets, type PopupInsetsWatch } from '@commise/ui/popup-insets';
import type { FC, ReactNode } from 'react';

/** The id of the foot the frame draws: the Back / forward row, with the dock above it while a timer runs. */
export const COOKING_FOOT_ID = 'cooking-foot';

/**
 * The room to keep clear for the foot.
 *
 * @param measure - The foot's top edge and the viewport's height, in CSS px. `footTop` is `undefined` when no foot draws.
 * @returns Nothing at the top, and at the bottom the distance from the foot's top edge to the viewport's bottom, or 0
 *   when there is no foot or it starts below the viewport. Pure.
 */
export function footInsetsOf({
    footTop,
    viewportHeight,
}: {
    readonly footTop: number | undefined;
    readonly viewportHeight: number;
}): PopupInsets {
    return { top: 0, bottom: footTop === undefined || footTop >= viewportHeight ? 0 : viewportHeight - footTop };
}

const readFootInsets = (): PopupInsets =>
    footInsetsOf({
        footTop: document.getElementById(COOKING_FOOT_ID)?.getBoundingClientRect().top,
        viewportHeight: document.documentElement.clientHeight,
    });

const NO_WATCH: PopupInsetsWatch = () => () => undefined;

const watchFoot: PopupInsetsWatch = (onChange) => {
    const foot = document.getElementById(COOKING_FOOT_ID);

    return (foot === null ? undefined : resizeWatchOf([foot]))?.(onChange) ?? NO_WATCH(onChange);
};

/** The cooking screen's foot, as the snackbar host reads it. */
export const CookingFootInsets: FC<{ readonly children: ReactNode }> = ({ children }) => (
    <PopupInsetsProvider reader={readFootInsets} watch={watchFoot}>
        {children}
    </PopupInsetsProvider>
);
