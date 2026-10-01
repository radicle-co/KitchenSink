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

export interface SheetProps {
    readonly open: boolean;
    /**
     * Every close route calls this with `false`: Close, Escape, the overlay or scrim, a swipe, Android back, and any
     * footer control the host wires to it.
     */
    readonly onOpenChange: (open: boolean) => void;
    /** The heading: the dialog's title (`h2` on web, header role on native). */
    readonly title: string;
    /** More elements that name the dialog, by id. Web `aria-labelledby` is the title's own id, then these; no native form. */
    readonly labelledBy?: readonly string[];
    /** Elements that describe the dialog, by id. Web `aria-describedby`; no native form. */
    readonly describedBy?: readonly string[];
    /** The accessible name of the icon-only close control. House form: "Close {thing}". */
    readonly closeLabel: string;
    /** `content`: as tall as its content, up to the available height. `full`: always the available height. */
    readonly size: 'content' | 'full';
    /** Pinned under the title, outside the scroll region. ⛔ With a toolbar, `children` holds no text input. */
    readonly toolbar?: SheetToolbar;
    /** The scroll region. */
    readonly children: ReactNode;
    /** Pinned at the bottom under a hairline, outside the scroll region. Hidden only while collapsed. */
    readonly footer?: ReactNode;
}
