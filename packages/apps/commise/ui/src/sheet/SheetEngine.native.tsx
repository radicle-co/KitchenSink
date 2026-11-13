/**
 * @module @commise/ui/sheet — the native sheet's engine: Tamagui's own `Sheet`, kept inside the window the host opens. It
 * moves ONE thing, a frame as tall as the window, in from the foot and out again; the panel stands at the foot of that frame
 * (the Container's `justifyContent`).
 *
 * Why a full-height frame and not `fit`: in `fit` mode the engine places the sheet from the height it measures for its
 * content, and on a device the first gate showed the sheet collapsed, with only its handle and the top of its title above
 * the foot of the screen. A frame as tall as the window is measured against a size the parent gives it, so its position
 * cannot depend on when the content lays out. The panel is content-sized inside it, and the screen above the panel is the
 * scrim's (`SheetScrim`, which asks the host to close).
 *
 * - `modal={false}`: no portal and no window of its own; `OverlayHost` is the window, and Back, the scrim, Close and the
 *   screen-reader escape all reach the host through it.
 * - `disableDrag`: the engine drags a frame from anywhere on it. The designer's rule is a drag from the handle and the title
 *   row only, so the panel owns the swipe (`useSwipeToDismiss`) and asks the host to close; the engine only animates the
 *   open and the exit.
 * - Controlled `open`, no state of its own: the host answers a close by changing `open` or not.
 * - `moveOnKeyboardChange={false}`: our `KeyboardAvoider` owns the keyboard, so there is one avoider, not two.
 * - Motion props come only from `motionPropsOf`, which treats an unread reduce-motion answer as instant.
 * - The scrim is the engine's overlay, drawn in the `$scrim` role at full strength (the engine's own skin dims it again).
 *
 * `onTransition` hands every report to the sheet, which reads the end of a close as the moment the window may leave.
 *
 * A presentational component: controlled by `open`, it holds no state and fetches nothing.
 *
 * @pattern Adapter over Tamagui's `Sheet` — its engine props and reports, in this design system's terms
 */
import type { FC, ReactNode } from 'react';
import { Sheet } from 'tamagui';

import { motionPropsOf } from '../motion/motionPropsOf.js';
import type { EngineTransition } from './sheetEngineLifecycle.js';

/** Props for {@link SheetEngine}. */
export interface SheetEngineProps {
    readonly open: boolean;
    /** Every transition the engine reports: an open, a snap, or a close, at its start and its end. */
    readonly onTransition: (event: EngineTransition) => void;
    readonly reduceMotion: boolean | undefined;
    readonly children: ReactNode;
}

/** The whole window: one snap point at the top, so the frame sits at rest where it is laid out. */
const FULL_HEIGHT = [100];

export const SheetEngine: FC<SheetEngineProps> = ({ open, onTransition, reduceMotion, children }) => {
    const motion = motionPropsOf(reduceMotion);

    return (
        <Sheet
            modal={false}
            open={open}
            onTransition={onTransition}
            disableDrag
            moveOnKeyboardChange={false}
            snapPointsMode="percent"
            snapPoints={FULL_HEIGHT}
            {...motion.sheet}
        >
            <Sheet.Overlay backgroundColor="$scrim" opacity={1} {...motion.overlay} />
            <Sheet.Container justifyContent="flex-end">{children}</Sheet.Container>
        </Sheet>
    );
};
