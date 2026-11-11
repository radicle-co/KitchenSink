'use client';

/**
 * @module @commise/features-recipes/editor — the web editor's action bar (build spec §7.1, §7.8): Preview, then the
 * primary at the end — Publish for a recipe not yet published, Save changes for a published one. Sticky at the foot of
 * the form column at every width; the one glass surface of the editor (owner D12), readable with the blur off. When the
 * header and the bar together are taller than half the viewport (`compactHeightLayout.md` A1) it is not sticky: it
 * scrolls with the page as the column's last content, in the same place in the page, so a focused control keeps focus.
 *
 * After a refused Publish, a polite line says how many things to fix (SC 3.3.1). While lines have no match, a quiet
 * polite line says the recipe is ready and that those lines' nutrition is left out (owner D20); Publish stays enabled. A finishing write shows the primary
 * busy and locks the bar.
 *
 * While a finish waits for its photos (`finishing`), Preview and the primary give way to one secondary control,
 * "Finish without the remaining photos", under a line that says what is happening. Both phases share the bar on
 * purpose: the line lands in a live region that already exists, which a screen reader announces, where a region
 * mounted together with its text is often not read out.
 *
 * Presentational: props → JSX. Its node leaves through `placeRef`, so the page can measure it.
 *
 * @pattern Adapter over external DOM geometry — the node reaches `usePinnedFooter` through a callback ref into state
 */
import { Button } from '@commise/ui/button';
import { ChromeSurface } from '@commise/ui/chrome-surface';
import { LiveRegion } from '@commise/ui/live-region';
import type { FC } from 'react';

import { EDITOR_ACTION_BAR_ID, type EditorActionBarProps } from './frameProps.js';

/** The web bar's props: the shared ones, whether it is pinned, and where its node goes to be measured. */
export interface WebEditorActionBarProps extends EditorActionBarProps {
    /** `false` past the A1 limit: the bar scrolls with the page. Absent means pinned (the native leaf places its bar). */
    readonly pinned?: boolean;
    /** Receives the bar's node (`usePinnedFooter`'s `footerRef`). */
    readonly placeRef?: (node: HTMLElement | null) => void;
}

/** The web editor's action bar. */
export const EditorActionBar: FC<WebEditorActionBarProps> = ({
    label,
    previewLabel,
    onPreview,
    primaryLabel,
    onPrimary,
    primaryDisabled,
    busy,
    fixLine,
    readyLine,
    notice,
    finishing,
    pinned = true,
    placeRef,
}) => (
    <div
        ref={placeRef}
        id={EDITOR_ACTION_BAR_ID}
        className={`${pinned ? 'sticky bottom-0 z-20' : 'relative'} isolate -mx-4 flex flex-col gap-2 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]`}
    >
        <ChromeSurface edge="top" />
        {notice}
        <LiveRegion politeness="polite" className="text-body-sm text-danger-text">
            {fixLine ?? (finishing?.danger === true ? finishing.line : '')}
        </LiveRegion>
        <LiveRegion politeness="polite" className="text-body-sm text-ink-muted">
            {readyLine ?? (finishing?.danger === false ? finishing.line : '')}
        </LiveRegion>
        <div role="group" aria-label={label} className="flex flex-wrap items-center justify-end gap-3">
            {finishing === undefined ? (
                <>
                    <Button variant="secondary" icon="eye" onPress={onPreview} disabled={busy}>
                        {previewLabel}
                    </Button>
                    <Button icon="check" onPress={onPrimary} busy={busy} disabled={primaryDisabled}>
                        {primaryLabel}
                    </Button>
                </>
            ) : (
                <Button
                    variant="secondary"
                    onPress={finishing.onAction}
                    focusRequested={finishing.focusRequested}
                    onFocusRequestHandled={finishing.onFocusRequestHandled}
                >
                    {finishing.actionLabel}
                </Button>
            )}
        </div>
    </div>
);
