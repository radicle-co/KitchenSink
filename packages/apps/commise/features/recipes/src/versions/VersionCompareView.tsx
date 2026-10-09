'use client';

/**
 * @module @commise/features-recipes — web compare panel (build spec §6.6): one version against the CURRENT one.
 *
 * A Radix Dialog drawn as a right-side panel (menus and sheets are the navigation and control layer). The caller
 * computes the diff (`compareWithCurrent`), so this leaf only lists it: each changed field or element with what the
 * version said and what the recipe says now, "None" where one side has no such element, or one line when they match.
 * Focus returns to the row menu’s trigger on close. Presentational: props → JSX, apart from the dialog’s own focus handling.
 *
 * @pattern Adapter over Radix Dialog — the panel's focus trap, Escape and return focus come from the primitive
 */
import { useMessages } from '@commise/i18n/react';
import { useReturnFocusOnClose } from '@commise/ui/dialog-focus';
import { Icon } from '@commise/ui/icon';
import * as Dialog from '@radix-ui/react-dialog';
import type { FC } from 'react';

import { fillTemplate } from '../list/model.js';
import { compareRowsOf, type VersionCompareViewProps } from './compare.js';
import { recipeVersionMessages } from './messages.js';

/** The web compare panel. */
export const VersionCompareView: FC<VersionCompareViewProps> = ({ open, version, diff, onClose }) => {
    const { compare, conflict } = useMessages(recipeVersionMessages);
    const onCloseAutoFocus = useReturnFocusOnClose(open);
    const rows = diff === undefined ? [] : compareRowsOf(diff, conflict);
    const versionNumber = version?.versionNumber ?? 0;

    return (
        <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
                <Dialog.Content
                    onCloseAutoFocus={onCloseAutoFocus}
                    aria-describedby={undefined}
                    className="fixed inset-y-0 end-0 z-50 flex w-full max-w-md flex-col gap-4 overflow-y-auto bg-paper-overlay p-6 shadow-lg"
                >
                    <div className="flex items-start justify-between gap-3">
                        <Dialog.Title className="text-section-title text-ink">
                            {fillTemplate(compare.title, { version: versionNumber })}
                        </Dialog.Title>
                        <Dialog.Close
                            aria-label={compare.close}
                            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-ink/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                        >
                            <Icon name="x" size={20} />
                        </Dialog.Close>
                    </div>
                    {rows.length === 0 ? (
                        <p className="text-body text-ink-muted">{compare.noChanges}</p>
                    ) : (
                        <ul className="flex flex-col divide-y divide-line-divider">
                            {rows.map((row) => (
                                <li key={row.key} className="flex flex-col gap-2 py-3">
                                    <span className="text-label text-ink">{row.label}</span>
                                    <dl className="grid grid-cols-1 gap-2 text-meta sm:grid-cols-2">
                                        <div className="flex flex-col gap-0.5">
                                            <dt className="text-caption text-ink-muted">
                                                {fillTemplate(compare.wasLabel, { version: versionNumber })}
                                            </dt>
                                            <dd className="break-words text-ink">
                                                {row.was === '' ? compare.noValue : row.was}
                                            </dd>
                                        </div>
                                        <div className="flex flex-col gap-0.5">
                                            <dt className="text-caption text-ink-muted">{compare.nowLabel}</dt>
                                            <dd className="break-words text-ink">
                                                {row.now === '' ? compare.noValue : row.now}
                                            </dd>
                                        </div>
                                    </dl>
                                </li>
                            ))}
                        </ul>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};
