/**
 * @module @commise/ui/sheet — the platform-neutral prop contract of the design-system `Sheet`
 * (`docs/design/ingredientSpecialization.md` §S8.1). The web leaf (`Sheet.tsx`, Radix Dialog) and the native leaf
 * (`Sheet.native.tsx`, a bottom-anchored `Modal`) both implement this surface.
 *
 * Controlled and stateless: the host decides what `open` means and what closing does. Every string is a
 * caller-supplied, already-localised prop.
 */
import type { ReactNode } from 'react';

/** The toolbar pinned under the title. */
export interface SheetToolbar {
    /** The label row. It holds nothing focusable. While the sheet is collapsed it moves into the title row. */
    readonly heading: ReactNode;
    /** The controls, such as a search input. They never move, so focus survives a collapse. */
    readonly controls: ReactNode;
}

/** Every prop of a sheet that does not depend on how it is presented. */
interface SheetBaseProps {
    readonly open: boolean;
    /**
     * The host has set the sheet aside for a moment (a question is up) and will bring it back as it was. `open` stays true.
     * The window leaves at once, with no exit and no scrim fade; nothing is reported as dismissed; and the opening is not a
     * new one, so the panel's scroll position is put back when it returns. What the cook typed is the host's, and so is
     * focus on the field that had it. Native only: React Native shows one window at a time on iOS. Absent: not held.
     */
    readonly held?: boolean;
    /**
     * Every close route calls this with `false`: Close, Escape, the overlay or scrim, a swipe, Android back, and any
     * footer control the host wires to it.
     */
    readonly onOpenChange: (open: boolean) => void;
    /**
     * Called once after each close, by any route, once the sheet is off screen: the moment a host can present what
     * comes next without two modals on screen at once (`docs/design/rowEditorBlueprint.md` decision 5). Never at
     * mount, and never while open.
     */
    readonly onDismissed?: () => void;
    /**
     * Called each time the sheet is on screen, once its window is shown: on native after the window's own `onShow`, on web
     * when it opens. The moment a host can move focus into a field of a sheet that has just come back: before it, the field
     * is not attached to a window yet and the focus is lost.
     */
    readonly onShown?: () => void;
    /**
     * Where the screen-reader cursor (web: keyboard focus) lands when the sheet opens. `title` (the default): on the
     * sheet's title. `content`: nowhere by the sheet's doing; the content's own focus request (a notice that must be read
     * first) is the only move, and a sheet with no such request leaves focus where it was. Read when the sheet opens.
     * Means the same on both platforms: web skips the title focus in `onOpenAutoFocus`, native skips the title's
     * accessibility focus event.
     */
    readonly screenReaderLanding?: 'title' | 'content';
    /** The heading: the dialog's title (`h2` on web, header role on native). */
    readonly title: string;
    /** More elements that name the dialog, by id. Web `aria-labelledby` is the title's own id, then these; no native form. */
    readonly labelledBy?: readonly string[];
    /** Elements that describe the dialog, by id. Web `aria-describedby`; no native form. */
    readonly describedBy?: readonly string[];
    /** The accessible name of the icon-only close control. House form: "Close {thing}". */
    readonly closeLabel: string;
    /** Pinned under the title, outside the scroll region. ⛔ With a toolbar, `children` holds no text input. */
    readonly toolbar?: SheetToolbar;
    /**
     * The host has a change in flight that this sheet asked for, so the whole sheet is waiting: web `aria-busy` on the dialog,
     * native `aria-busy` on its dialog view. It changes nothing on screen by itself; the host dims what it disables.
     */
    readonly busy?: boolean;
    /** The scroll region. */
    readonly children: ReactNode;
    /**
     * The actions, under a hairline at the bottom. Pinned while it and the title row take half the sheet or less; past
     * that it scrolls with the content (`isFooterUnpinned`), and Close stays pinned. Hidden only while collapsed.
     */
    readonly footer?: ReactNode;
}

/**
 * How a sheet is presented, and the size that goes with it. The one illegal pair, a dialog that is not `content`,
 * cannot be written.
 */
type SheetShape =
    | {
          /**
           * `sheet` (the default): a bottom sheet at every width, at most 560 dp (native) or 35 rem (web) wide.
           * `dialog`: a bottom sheet on a phone and, from the tablet width (native 600 dp, web `sm`), a CENTRED dialog
           * at most 448 wide (owner rulings 2026-10-26 and 2026-11-17: a centred modal only for an ask that stops the
           * action just taken until the cook chooses). A dialog is only ever `content`.
           */
          readonly presentation?: 'sheet';
          /**
           * `content`: as tall as its content, up to the available height. `full`: always the available height.
           * `page`: a page-sized sheet, the available height. On web from `sm`, `content` stops at 85% of the visible
           * height, `full` is 85% of it, and `page` is the visible height less 2 rem and as wide as the detail column
           * (72 rem). Native has no wider-than-phone variant, so there `page` is the same as `full`.
           */
          readonly size: 'content' | 'full' | 'page';
      }
    | { readonly presentation: 'dialog'; readonly size: 'content' };

export type SheetProps = SheetBaseProps & SheetShape;
