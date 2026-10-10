/**
 * @module @commise/ui/section-switch — the shared contract of the design-system `SectionSwitch`
 * (`docs/design/uiOverhaul/buildSpec.md` §6.2): a sticky bar of links to a page's sections, the current one marked,
 * with room for one trailing control.
 *
 * The current section is the caller's, read from the screen's scroll spy (`ScrollHost`, blueprint A7); the switch
 * only draws it. Every label is the caller's localised copy.
 */
import type { ReactNode } from 'react';

/** One section the switch links to. `id` is the section heading's element id (web) or section id (native). */
export interface SectionLink {
    readonly id: string;
    readonly label: string;
}

/** Props for the `SectionSwitch` leaves (web and native). */
export interface SectionSwitchProps {
    /** The navigation's name ("Recipe sections"). */
    readonly label: string;
    /** The sections, in page order. */
    readonly sections: readonly SectionLink[];
    /** The section the reader is in, if the screen's scroll spy knows it. */
    readonly currentId?: string;
    /** One control after the links (the recipe page puts "Screen on" here). */
    readonly trailing?: ReactNode;
    /** Called with the section pressed, after the screen's scroll host has jumped to it. */
    readonly onJump?: (id: string) => void;
}
