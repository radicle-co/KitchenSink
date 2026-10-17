/**
 * @module @commise/ui/popover — the platform-neutral contract of the design-system `Popover`: a small panel a TRIGGER
 * opens by activation and nothing else (`docs/design/ingredientStatusExplanation.md` §6d — no hover, so WCAG 1.4.13
 * is not applicable by construction). The web leaf (`Popover.tsx`) is a Radix Popover anchored to the trigger; the
 * native leaf (`Popover.native.tsx`) is the design-system `Sheet`, because a phone has no room to anchor beside a row
 * (§8e "moved").
 *
 * The primitive owns its trigger, so the trigger's `aria-expanded`/`aria-controls` and the panel's open state can
 * never disagree. Every string is a caller-supplied, already-localised prop.
 */
import type { ReactNode } from 'react';

import type { IconName } from '../icon/props.js';

/** Props for the `Popover` leaves (web and native). */
export interface PopoverProps {
    /**
     * The trigger's accessible name. ⛔ It names what the panel is ABOUT (a row's food, say), never a bare "More": a
     * list of identical names is unusable by voice control and by a screen-reader rotor.
     */
    readonly triggerLabel: string;
    /** The meaning the trigger's glyph draws, from the icon Registry. Decorative: the leaf hides it. */
    readonly triggerIcon: IconName;
    /**
     * Words drawn beside the glyph, in the `attention` role: the trigger becomes a read row's attention line ("⚠ Choose
     * a match", `docs/design/uiOverhaul/buildSpec.md` §7.5.1). ⛔ {@link triggerLabel} must CONTAIN these words (SC
     * 2.5.3). Absent, the trigger is the 44 px glyph button.
     */
    readonly triggerText?: string;
    /** The panel's heading: it names the web dialog and titles the native sheet. */
    readonly title: string;
    /** The accessible name of the panel's Close control. House form: "Close {thing}". */
    readonly closeLabel: string;
    /**
     * The panel's body. As a function it receives `close`, for an action inside the panel that ends it (a Try again
     * that hands the work to the trigger): focus returns to the trigger as on every other close route.
     */
    readonly children: ReactNode | ((close: () => void) => ReactNode);
    /**
     * The trigger's work is in flight: `aria-busy`, and the glyph gives way to a spinner in the same box, so busy is
     * visible as well as announced. It stays focusable: a busy control is the one just pressed, so focus must not be
     * thrown off it.
     */
    readonly busy?: boolean;
    /** Web: the id of an element that describes the trigger (`aria-describedby`), such as its row's status word. */
    readonly describedBy?: string;
    /**
     * A host asks for focus on the trigger: keyboard focus on web, the screen-reader cursor on native (V1 sign-off item
     * 11, the next row's glyph after a Remove). A LEVEL, not a counter: it stands until {@link onFocusRequestHandled}
     * acknowledges it, so a trigger that mounts while the request stands still takes it.
     */
    readonly focusRequested?: boolean;
    /** Called once the trigger has taken a requested focus; the host clears its request here. */
    readonly onFocusRequestHandled?: () => void;
    /**
     * Called once as the panel goes, by any close route. A host that moves focus on from here raises a focus request,
     * which its target takes after render, so it lands after the panel's own return to the trigger.
     */
    readonly onDismissed?: () => void;
}
