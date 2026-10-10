'use client';

/**
 * @module @commise/features-recipes/editor — the web editor's header (build spec §7.1): × "Close editor", the title
 * ("New recipe" or "Edit recipe", the page's one H1, never the recipe's own title), the save status in `caption`, and
 * ⋯ "More editor actions" holding the one destructive action. 56 px, sticky, on the page's solid surface — the
 * editor's only glass is its action bar (owner D12).
 *
 * × never asks (Settled 24): the editor saves by itself, so leaving loses nothing.
 *
 * Presentational: props → JSX. Its node leaves through `placeRef`, so the page can measure the pinned chrome.
 *
 * @pattern Adapter over external DOM geometry — the node reaches `usePinnedFooter` through a callback ref into state
 */
import { ActionMenu } from '@commise/ui/action-menu';
import { Icon } from '@commise/ui/icon';
import type { FC } from 'react';

import { EDITOR_HEADER_ID, type EditorHeaderProps } from './frameProps.js';

/** The web header's props: the shared ones, and where its node goes to be measured. */
export interface WebEditorHeaderProps extends EditorHeaderProps {
    /** Receives the header's node (`usePinnedFooter`'s `topRef`). */
    readonly placeRef?: (node: HTMLElement | null) => void;
}

/** The web editor header. */
export const EditorHeader: FC<WebEditorHeaderProps> = ({ title, status, closeLabel, onClose, menu, placeRef }) => (
    <header
        ref={placeRef}
        id={EDITOR_HEADER_ID}
        className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line-divider bg-paper px-2"
    >
        <button
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
            <Icon name="x" size={24} />
        </button>
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
            <h1 className="shrink-0 truncate text-bar-title text-ink">{title}</h1>
            {status !== undefined && <p className="min-w-0 truncate text-caption text-ink-muted">{status}</p>}
        </div>
        {menu !== undefined && (
            <ActionMenu
                triggerLabel={menu.triggerLabel}
                title={title}
                closeLabel={menu.closeLabel}
                items={[]}
                destructiveItem={{ id: 'discard', label: menu.discardLabel, onSelect: menu.onDiscard }}
            />
        )}
    </header>
);
