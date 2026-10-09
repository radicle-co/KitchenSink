/**
 * @module @commise/ui/sheet — the web sheet's skeleton: the title row with Close, the toolbar, the scroll region
 * and the footer (`docs/design/ingredientSpecialization.md` §S8.1).
 *
 * It alone applies the collapse (`isToolbarCollapsed`): with an on-screen keyboard open and focus in the toolbar's
 * controls, the title is visually hidden (it still names the dialog), the heading moves into the title row, and the
 * footer hides. ⛔ Close and the controls never change position in the tree: a remounted input loses focus, the
 * keyboard closes, and the sheet expands again, over and over. The heading's two slots are the only moving part.
 *
 * The footer is the scroll region's LAST CHILD, always. While pinned it is `sticky` at the region's bottom, opaque, so
 * the content scrolls beneath it; once the title row and the footer together take more than half the sheet
 * (`isFooterUnpinned`, owner ruling on I7) it drops into normal flow and scrolls with the content, while Close stays
 * pinned in the title row. Pinned or not, it is the same node in the same place, so keyboard focus on a footer control
 * survives the flip (SC 2.4.3). Heights come from `usePinnedFooter` (`@commise/ui/pinned-footer`).
 *
 * Mounted once per open (inside `Dialog.Content`), so its focus and measurement state start fresh each time.
 *
 * A presentational component: its only state is whether focus is in the toolbar, and the measured heights.
 *
 * @pattern Template Method — the fixed chrome, with host-supplied steps (heading, controls, children, footer)
 */
import * as Dialog from '@radix-ui/react-dialog';
import type { FC, ReactNode } from 'react';

import { isToolbarCollapsed } from './onScreenKeyboard.js';
import type { SheetToolbar } from './props.js';
import { useFocusWithin } from './useFocusWithin.js';
import { Icon } from '../icon/Icon.js';
import { usePinnedFooter } from '../layout/usePinnedFooter.js';

/** The footer's box: a hairline above it, and opaque, because pinned content scrolls beneath it. */
const FOOTER = 'shrink-0 border-t border-line-divider bg-paper-overlay px-6 py-4';

export interface SheetPanelProps {
    readonly title: string;
    /** The title's id, which the dialog's `aria-labelledby` names first. */
    readonly titleId: string;
    readonly closeLabel: string;
    readonly toolbar?: SheetToolbar;
    readonly footer?: ReactNode;
    readonly children: ReactNode;
    /** Whether an on-screen keyboard is open (`useVisualViewportKeyboard`). */
    readonly keyboardOpen: boolean;
    readonly onClose: () => void;
}

export const SheetPanel: FC<SheetPanelProps> = ({
    title,
    titleId,
    closeLabel,
    toolbar,
    footer,
    children,
    keyboardOpen,
    onClose,
}) => {
    const controls = useFocusWithin();
    const collapsed = toolbar !== undefined && isToolbarCollapsed(keyboardOpen, controls.focusWithin);
    const { unpinned, footerHeight, frameRef, topRef, footerRef } = usePinnedFooter();
    const footerShown = footer !== undefined && !collapsed;

    return (
        <div ref={frameRef} className="flex min-h-0 flex-1 flex-col">
            <div ref={topRef} className="flex items-start gap-2 pl-6 pr-2 pt-2">
                <div className="min-w-0 flex-1 pt-3">
                    <Dialog.Title
                        id={titleId}
                        tabIndex={-1}
                        className={
                            collapsed ? 'sr-only' : 'font-display text-heading-md font-semibold text-ink outline-none'
                        }
                    >
                        {title}
                    </Dialog.Title>
                    {collapsed ? toolbar.heading : null}
                </div>
                <button
                    type="button"
                    aria-label={closeLabel}
                    onClick={onClose}
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-ink-muted transition hover:bg-ink/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                    <Icon name="x" size={20} />
                </button>
            </div>
            {toolbar === undefined ? null : (
                <div className="flex flex-col gap-2 px-6 pt-2">
                    {collapsed ? null : toolbar.heading}
                    <div onFocus={controls.onFocus} onBlur={controls.onBlur}>
                        {toolbar.controls}
                    </div>
                </div>
            )}
            {/* A column that fills the region, so a short sheet still puts its footer at the bottom. While the footer is
                pinned, its height is the region's scroll padding, so the browser scrolls a focused row clear of it
                (SC 2.4.11, technique C43). */}
            <div
                className="flex min-h-0 flex-1 flex-col overflow-y-auto"
                style={footerShown && !unpinned ? { scrollPaddingBottom: `${footerHeight}px` } : undefined}
            >
                <div className="shrink-0 grow px-6 py-4">{children}</div>
                {footerShown && (
                    <div ref={footerRef} className={unpinned ? FOOTER : `${FOOTER} sticky bottom-0`}>
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
};
