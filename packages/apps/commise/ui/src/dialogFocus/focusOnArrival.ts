/**
 * @module @commise/ui/dialog-focus — move focus to content that has just arrived in a dialog, unless the person
 * already put focus somewhere in it.
 *
 * A dialog's content can arrive after the dialog opens (a read that settles, a retry that lands), and the content
 * should take focus then (WCAG 2.2 SC 2.4.3). But a person who moved to Close while the content loaded must keep that
 * focus. Two places do not count as chosen: the dialog's TITLE, where the design-system `Sheet` puts focus on open,
 * and the dialog element ITSELF, where Radix's focus scope leaves focus when the focused control unmounts (Try again,
 * Clear). The title is the dialog's first `aria-labelledby` id, the `Sheet`'s contract (`SheetProps.labelledBy`).
 *
 * This differs from `focusIfLost` (`./focusIfLost.ts`), which also yields to anything inside its region. Here the region is the whole
 * dialog, and its title and frame are exactly where focus waits for the content.
 *
 * WEB ONLY: it reads `document.activeElement`.
 */
/**
 * Focus `target` unless focus is on a control the person chose inside `target`'s dialog.
 *
 * @param target - The element the dialog wants focused; nothing happens when it is not mounted.
 * @sideEffect Moves DOM focus.
 */
export function focusOnArrival(target: HTMLElement | null): void {
    if (target === null) {
        return;
    }

    const dialog = target.closest('[role="dialog"]');
    const titleId = dialog?.getAttribute('aria-labelledby')?.split(' ')[0];
    const holder = document.activeElement;
    const chosen =
        holder !== null &&
        holder !== document.body &&
        holder !== dialog &&
        dialog?.contains(holder) === true &&
        holder.id !== titleId;

    if (!chosen) {
        target.focus();
    }
}
