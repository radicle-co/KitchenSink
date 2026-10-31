/**
 * @module @commise/ui/dialog-actions — the web design-system {@link DialogActions}: the action row of a dialog or sheet.
 * A presentational component: props to JSX, no state and no side effect.
 *
 * Two elements, because a container query styles a container's DESCENDANTS and never the container itself: an outer
 * `@container/dialog` wrapper that is the thing measured, and the flex row inside it (`dialogActionsRow`). The
 * wrapper has inline-size containment, so it takes no width from its content and must be STRETCHED by its parent:
 * put it in a `flex-col` parent with the default stretch, as both `ConfirmDialog` and `VersionPreviewModal` do. Never
 * put it inside a row or an `items-center` column, where it would collapse to nothing.
 *
 * The buttons are direct children of the row, in source order (dismiss first, main action last), so the DOM and
 * focus order never change with the layout. A design-system `Button` passes `width="fill"`; a Radix slot wears
 * {@link dialogActionSlotClass} for the same threshold.
 *
 * @pattern Responsive layout by container query — the row answers to its own box, not the viewport's, so one rule
 *     serves a 448 px alert and a 672 px preview.
 */
import type { FC } from 'react';

import { dialogActionsRowClass } from './dialogActionsClass.js';
import type { DialogActionsProps } from './props.js';

export const DialogActions: FC<DialogActionsProps> = ({ sideBySideFrom, children }) => (
    <div className="@container/dialog w-full">
        <div className={dialogActionsRowClass(sideBySideFrom)}>{children}</div>
    </div>
);
