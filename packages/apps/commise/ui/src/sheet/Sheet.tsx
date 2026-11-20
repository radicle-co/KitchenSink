/**
 * @module @commise/ui/sheet — the web design-system `Sheet` (`docs/design/ingredientSpecialization.md` §S8.1).
 *
 * Full screen below `sm`, the house centred dialog from `sm` (`max-w-lg`, `max-h-[85vh]`); `size="full"` holds the
 * dialog at 85% of the viewport, and `size="page"` is a page-sized sheet: the whole visible height, up to the detail
 * column. Radix owns the focus trap, Escape, the overlay and hiding the rest of the page.
 * This leaf adds what Radix does not:
 *
 * - `aria-modal`, and `aria-labelledby`/`aria-describedby` built from the title's id, `labelledBy` and
 *   `describedBy` (Radix spreads these props after its own, so they win);
 * - focus to the title on open, unless `screenReaderLanding="content"` leaves the landing to the content (Radix does not
 *   fire this when content already took focus, so content that focuses itself on mount keeps it either way), and back
 *   to a SIBLING opener on close (`useReturnFocusOnClose`: Radix returns focus only to an owned trigger);
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
import { surfaceToneClass } from '../surfaceTone/surfaceToneClass.js';

/**
 * The geometry every cell shares, with no `sm:` utility: a fixed, full-width, stacked panel in the paper tone. What
 * differs by size and presentation is in the maps below, ONE utility per property per cell.
 */
const CONTENT = `fixed inset-x-0 z-50 flex w-full flex-col ${surfaceToneClass('paperOverlay')}`;

/**
 * The foot anchor: the bottom edge of the visible box (`100%` of a fixed box is the layout viewport, so the offset is
 * what a keyboard covers). Written whole because Tailwind builds only class text it can find.
 */
const FOOT = 'bottom-[calc(100%-var(--sheet-visible-top,0px)-var(--sheet-visible-height,100%))]';
const FOOT_FROM_SM = 'sm:bottom-[calc(100%-var(--sheet-visible-top,0px)-var(--sheet-visible-height,100%))]';

/** The whole visible box: `full` and `page` below `sm`. */
const PHONE_VISIBLE_BOX = 'top-[var(--sheet-visible-top,0px)] h-[var(--sheet-visible-height,100dvh)]';

/**
 * The geometry below `sm`, per size (`buildSpec.md` §1.6, "content by default"; F11).
 *
 * - `full` and `page` take the whole visible box: its top follows an iOS pan, its height a keyboard.
 * - `content` is a bottom sheet, as tall as its content: anchored to the foot of the visible box, capped at the visible
 *   height less a 2 rem gap so the page behind stays in view, with rounded top corners.
 *
 * ⛔ No shared `top-*`/`h-*` in {@link CONTENT}: Tailwind decides between two utilities of one variant by the order it
 * emits them, not the order in the class string. That holds for every cell below.
 */
const PHONE: Readonly<Record<SheetProps['size'], string>> = {
    full: PHONE_VISIBLE_BOX,
    page: PHONE_VISIBLE_BOX,
    content: `${FOOT} max-h-[calc(var(--sheet-visible-height,100dvh)-2rem)] rounded-t-xl shadow-lg`,
};

/** What a bottom sheet adds from `sm`: centred in the window by its margins, top corners round, a shadow (CL-394). */
const SHEET_FROM_SM = 'sm:mx-auto sm:rounded-t-xl sm:shadow-lg';

/**
 * The box of a bottom sheet from `sm` (CL-394, designer spec): ONE utility each of height, its cap, its width cap and
 * its anchor per size. Every sheet stays on the foot of the visible box at every width, so a keyboard lifts it.
 *
 * - `content`: as tall as its content, at most 85% of the visible height, at most 35 rem (560 px at the default text
 *   size, and the same line length when the cook enlarges text). The phone cell's own anchor still holds.
 * - `full`: exactly 85% of the visible height, so the sheet does not jump as rows change. `sm:top-auto` undoes the
 *   phone cell's `top-*`.
 * - `page`: the visible height less 2 rem, so a strip of the page behind shows, up to the detail column (72 rem).
 */
const FROM_SM: Readonly<Record<SheetProps['size'], string>> = {
    content: `${SHEET_FROM_SM} sm:h-auto sm:max-h-[calc(var(--sheet-visible-height,100dvh)*0.85)] sm:max-w-[35rem]`,
    full:
        `${SHEET_FROM_SM} sm:top-auto ${FOOT_FROM_SM} sm:h-[calc(var(--sheet-visible-height,100dvh)*0.85)] ` +
        'sm:max-w-[35rem]',
    page: `${SHEET_FROM_SM} sm:top-auto ${FOOT_FROM_SM} sm:h-[calc(var(--sheet-visible-height,100dvh)-2rem)] sm:max-w-6xl`,
};

/**
 * A `dialog` presentation's `content` box from `sm`: centred on the visible box's centre (with no keyboard the
 * fallbacks give the window's 50%), 448 px (`max-w-md`), as tall as its content, up to the house cap. The only cell
 * that is centred in the window (owner ruling 2026-11-17).
 */
const DIALOG_FROM_SM =
    'sm:inset-x-auto sm:left-1/2 sm:top-[calc(var(--sheet-visible-top,0px)+var(--sheet-visible-height,100%)/2)] ' +
    'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:bottom-auto sm:rounded-xl sm:shadow-lg sm:h-auto ' +
    'sm:max-h-[min(85vh,var(--sheet-visible-height,85vh))] sm:max-w-md';

export const Sheet: FC<SheetProps> = ({
    open,
    onOpenChange,
    onDismissed,
    onShown,
    title,
    labelledBy = [],
    describedBy = [],
    closeLabel,
    size,
    presentation = 'sheet',
    screenReaderLanding = 'title',
    busy = false,
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
                    aria-busy={busy || undefined}
                    aria-labelledby={[titleId, ...labelledBy].join(' ')}
                    aria-describedby={describedBy.length > 0 ? describedBy.join(' ') : undefined}
                    onOpenAutoFocus={(event) => {
                        event.preventDefault();

                        if (screenReaderLanding === 'title') {
                            document.getElementById(titleId)?.focus();
                        }

                        onShown?.();
                    }}
                    onCloseAutoFocus={(event) => {
                        returnFocus(event);
                        onDismissed?.();
                    }}
                    style={style}
                    className={`${CONTENT} ${PHONE[size]} ${presentation === 'dialog' ? DIALOG_FROM_SM : FROM_SM[size]}`}
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
