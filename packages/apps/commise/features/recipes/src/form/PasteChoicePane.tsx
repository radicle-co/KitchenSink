'use client';

/**
 * @module @commise/features-recipes/form — `PasteChoicePane` (web): the side pane at 1194 and on web
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`). A named `aside`: which open line it shows out
 * of how many, the line as its heading, the muted prompt, the line's `FoodChoiceList`, then Previous and Next open line.
 *
 * Previous and Next are always drawn and are disabled at an end, so nothing moves under the cook and the pair never
 * changes shape (a top-level `hasNext && <Button>` would also be §11.2's boolean-selects-a-subtree). A pick in the pane
 * does not move on by itself (staff-ux ruling 2026-10-25): the check appears on the row, and Next moves on.
 *
 * Presentational: props in, markup out. The native leaf is `./PasteChoicePane.native.tsx`.
 */
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import { FoodChoiceList } from '../ingredientMatching/FoodChoiceList.js';
import type { PasteChoicePaneProps } from './pasteChoicePaneProps.js';

/** The side pane. */
export const PasteChoicePane: FC<PasteChoicePaneProps> = ({ view, onPrevious, onNext, ...list }) => (
    <aside aria-label={view.label} className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
            <p className="text-meta text-ink-muted">{view.position}</p>
            <h2 className="break-words text-card-title text-ink">{view.heading}</h2>
            {view.open.prompt === undefined ? null : (
                <p className="break-words text-meta text-ink-muted">{view.open.prompt}</p>
            )}
        </div>
        <FoodChoiceList view={view.open.list} {...list} />
        <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" icon="chevronLeft" disabled={view.previous.disabled} onPress={onPrevious}>
                {view.previous.label}
            </Button>
            <Button
                variant="ghost"
                icon="chevronRight"
                iconPlacement="end"
                disabled={view.next.disabled}
                onPress={onNext}
            >
                {view.next.label}
            </Button>
        </div>
    </aside>
);
