'use client';

/**
 * @module @commise/features-recipes/form — `PasteMatchOpenRow` (web): the one open pasted line on phone and 834
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`). The line, its muted prompt ("Choose the milk
 * you use"), then its `FoodChoiceList`: Search for a food first, the options, Keep as written last. Which line is open,
 * and opening the next after a pick, are the host's (the wiring phase).
 *
 * The row is set apart by an edge, not a fill: its options use `surfaceMuted` for hover, which a fill of the same
 * colour would hide.
 *
 * Presentational: props in, markup out. The native leaf is `./PasteMatchOpenRow.native.tsx`.
 */
import type { FC } from 'react';

import { FoodChoiceList } from './FoodChoiceList.js';
import { PastedLine } from './PastedLine.js';
import type { PasteMatchOpenRowProps } from './pasteMatchOpenRowProps.js';

/** The open pasted line. */
export const PasteMatchOpenRow: FC<PasteMatchOpenRowProps> = ({ line, ...list }) => (
    <li className="flex flex-col gap-2 rounded-xl border border-line-divider px-3 py-3">
        <div className="flex flex-col gap-1">
            <PastedLine line={line} />
            <p className="break-words text-meta text-ink-muted">{list.view.prompt}</p>
        </div>
        <FoodChoiceList {...list} />
    </li>
);
