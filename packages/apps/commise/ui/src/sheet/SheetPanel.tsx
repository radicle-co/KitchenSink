/**
 * @module @commise/ui/sheet — the web sheet's skeleton: the title row with Close, the toolbar, the scroll region
 * and the footer (`docs/design/ingredientSpecialization.md` §S8.1).
 *
 * It alone applies the collapse (`isToolbarCollapsed`): with an on-screen keyboard open and focus in the toolbar's
 * controls, the title is visually hidden (it still names the dialog), the heading moves into the title row, and the
 * footer hides. ⛔ Close and the controls never change position in the tree: a remounted input loses focus, the
 * keyboard closes, and the sheet expands again, over and over. The heading's two slots are the only moving part.
 *
 * Mounted once per open (inside `Dialog.Content`), so its focus state starts fresh each time.
 *
 * A presentational component: its only state is whether focus is in the toolbar.
 *
 * @pattern Template Method — the fixed chrome, with host-supplied steps (heading, controls, children, footer)
 */
import * as Dialog from '@radix-ui/react-dialog';
import type { FC, ReactNode } from 'react';

import { isToolbarCollapsed } from './onScreenKeyboard.js';
import type { SheetToolbar } from './props.js';
import { useFocusWithin } from './useFocusWithin.js';

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

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-start gap-2 pl-6 pr-2 pt-2">
                <div className="min-w-0 flex-1 pt-3">
                    <Dialog.Title
                        id={titleId}
                        tabIndex={-1}
                        className={
                            collapsed
                                ? 'sr-only'
                                : 'font-display text-heading-md font-semibold text-charcoal outline-none'
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
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-slate transition hover:bg-pearl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seafoam"
                >
                    <svg aria-hidden="true" viewBox="0 0 20 20" width="20" height="20" fill="none">
                        <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
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
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
            {footer === undefined || collapsed ? null : <div className="border-t border-mist px-6 py-4">{footer}</div>}
        </div>
    );
};
