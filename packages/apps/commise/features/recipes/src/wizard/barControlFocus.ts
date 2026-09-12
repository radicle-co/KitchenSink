/**
 * @module @commise/features-recipes/wizard — the names of the web wizard's bar controls, so the one that had focus can
 * take it again after the bar moves (`docs/design/compactHeightLayout.md` §4.4, SC 2.4.3). A flip places the bar in its
 * other slot, which remounts it, and focus on a control that unmounts falls to the page; `@commise/ui/pinned-footer`
 * reads which control had focus through {@link BAR_CONTROL_FOCUS}.
 *
 * Each control's slot names it with {@link BAR_CONTROL_ATTRIBUTE}. The name is parsed back into {@link BarControl}
 * where it is read, so a stray value is no control at all.
 */
import type { FooterFocusCarry } from '@commise/ui/pinned-footer';

/** The bar's controls. `primary` is Next, or Publish on the last step, which share one place. */
export const BAR_CONTROLS = ['previous', 'saveDraft', 'primary'] as const;

export type BarControl = (typeof BAR_CONTROLS)[number];

/** The attribute a control's slot carries, with its {@link BarControl} as the value. */
export const BAR_CONTROL_ATTRIBUTE = 'data-bar-control';

/**
 * The props that name a control's slot. Pure.
 *
 * @param control - The control the slot holds.
 * @returns The attribute, to spread onto the slot.
 */
export function barControlSlot(control: BarControl): { readonly [BAR_CONTROL_ATTRIBUTE]: BarControl } {
    return { [BAR_CONTROL_ATTRIBUTE]: control };
}

/**
 * Whether a value names a bar control. Pure.
 *
 * @param value - The attribute's value, if any.
 * @returns `true` for a {@link BarControl}.
 */
export function isBarControl(value: string | null | undefined): value is BarControl {
    return BAR_CONTROLS.some((control) => control === value);
}

/** How the pinned-footer hook names the bar's controls: by their slot's attribute, parsed back into a control. */
export const BAR_CONTROL_FOCUS: FooterFocusCarry<BarControl> = {
    attribute: BAR_CONTROL_ATTRIBUTE,
    parse: (value) => (isBarControl(value) ? value : null),
};
