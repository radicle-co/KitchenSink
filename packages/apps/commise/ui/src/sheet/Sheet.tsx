/**
 * @module @commise/ui/sheet — the web design-system `Sheet` (`docs/design/ingredientSpecialization.md` §S8.1).
 *
 * Full screen below `sm`, the house centred dialog from `sm` (`max-w-lg`, `max-h-[85vh]`); `size="full"` holds the
 * dialog at 85% of the viewport. Radix owns the focus trap, Escape, the overlay and hiding the rest of the page.
 * This leaf adds what Radix does not:
 *
 * - `aria-modal`, and `aria-labelledby`/`aria-describedby` built from the title's id, `labelledBy` and
 *   `describedBy` (Radix spreads these props after its own, so they win);
 * - focus to the title on open (Radix does not fire this when content already took focus, so content that focuses
 *   itself on mount keeps it), and back to a SIBLING opener on close (`useReturnFocusOnClose`: Radix returns focus
 *   only to an owned trigger);
 * - the visible box while an on-screen keyboard is open, as `--sheet-visible-height` and `--sheet-visible-top`, so the
 *   sheet sits inside the visual viewport instead of under the keyboard: below `sm` its top is the box's top (which
 *   follows an iOS pan), and from `sm` it centres on the box's centre, not the window's (E2 I5);
 * - `onDismissed` from `onCloseAutoFocus`, which Radix fires once the closed content has unmounted, and after focus
 *   is back on the opener.
 *
 * A presentational component: controlled by `open`, it fetches nothing and holds no domain state.
 *
 * @pattern Adapter over `@radix-ui/react-dialog` — the skeleton and the collapse are `SheetPanel`'s Template Method.
 */
import * as Dialog from '@radix-ui/react-dialog';
import { useId, type CSSProperties, type FC } from 'react';

import { useReturnFocusOnClose } from '../dialogFocus/useReturnFocusOnClose.js';
import type { SheetProps } from './props.js';
import { SheetPanel } from './SheetPanel.js';
import { useVisualViewportKeyboard } from './useVisualViewportKeyboard.js';

/**
 * The geometry every size shares. From `sm` the sheet is a dialog centred in the visible box; with no keyboard the two
 * variables are unset and the fallbacks give the window's 50%.
 */
const CONTENT =
    'fixed inset-x-0 z-50 flex w-full flex-col bg-paper-overlay sm:inset-x-auto sm:left-1/2 ' +
    'sm:top-[calc(var(--sheet-visible-top,0px)+var(--sheet-visible-height,100%)/2)] ' +
    'sm:max-h-[min(85vh,var(--sheet-visible-height,85vh))] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 ' +
    'sm:rounded-2xl sm:shadow-lg';

/**
 * The geometry below `sm`, per size (`buildSpec.md` §1.6, "content by default"; F11).
 *
 * - `full` takes the whole visible box: its top follows an iOS pan, its height a keyboard.
 * - `content` is a bottom sheet, as tall as its content: anchored to the foot of the visible box (`100%` of a fixed
 *   box is the layout viewport, so the offset is what a keyboard covers), capped at the visible height less a 2 rem gap
 *   so the page behind stays in view, with rounded top corners. `sm:bottom-auto` hands it to the centred dialog.
 *
 * ⛔ No shared `top-*`/`h-*` in {@link CONTENT}: Tailwind decides between two utilities of one variant by the order it
 * emits them, not the order in the class string.
 */
const PHONE: Readonly<Record<SheetProps['size'], string>> = {
    full: 'top-[var(--sheet-visible-top,0px)] h-[var(--sheet-visible-height,100dvh)]',
    content:
        'bottom-[calc(100%-var(--sheet-visible-top,0px)-var(--sheet-visible-height,100%))] ' +
        'max-h-[calc(var(--sheet-visible-height,100dvh)-2rem)] rounded-t-xl shadow-lg sm:bottom-auto',
};

/**
 * The height from `sm`, ONE utility per size. ⛔ Never a shared `sm:h-*` in `CONTENT` plus another here: Tailwind
 * decides between two utilities of one variant by the order it emits them, not the order in the class string, so a
 * shared `sm:h-auto` silently beats `sm:h-[85vh]`.
 */
const HEIGHT: Readonly<Record<SheetProps['size'], string>> = { content: 'sm:h-auto', full: 'sm:h-[85vh]' };

export const Sheet: FC<SheetProps> = ({
    open,
    onOpenChange,
    onDismissed,
    title,
    labelledBy = [],
    describedBy = [],
    closeLabel,
    size,
    toolbar,
    children,
    footer,
}) => {
    const titleId = useId();
    const returnFocus = useReturnFocusOnClose(open);
    const visible = useVisualViewportKeyboard();
    const style =
        visible === null
            ? undefined
            : ({
                  '--sheet-visible-height': `${visible.height}px`,
                  '--sheet-visible-top': `${visible.top}px`,
              } as CSSProperties);

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
                <Dialog.Content
                    aria-modal="true"
                    aria-labelledby={[titleId, ...labelledBy].join(' ')}
                    aria-describedby={describedBy.length > 0 ? describedBy.join(' ') : undefined}
                    onOpenAutoFocus={(event) => {
                        event.preventDefault();
                        document.getElementById(titleId)?.focus();
                    }}
                    onCloseAutoFocus={(event) => {
                        returnFocus(event);
                        onDismissed?.();
                    }}
                    style={style}
                    className={`${CONTENT} ${PHONE[size]} ${HEIGHT[size]}`}
                >
                    <SheetPanel
                        title={title}
                        titleId={titleId}
                        closeLabel={closeLabel}
                        toolbar={toolbar}
                        footer={footer}
                        keyboardOpen={visible !== null}
                        onClose={() => onOpenChange(false)}
                    >
                        {children}
                    </SheetPanel>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};
