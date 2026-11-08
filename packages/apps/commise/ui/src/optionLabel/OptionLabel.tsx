/**
 * @module @commise/ui/option-label — the web design-system {@link OptionLabel}: an option's name, a quiet `note`
 * `StatusBadge` after it, and a `VariantPartsLine` under it. The tag flows after the label and wraps under it at
 * 320 px; the label can shrink below its longest word (`min-w-0`) and breaks rather than push the row sideways. One
 * drawing for the Combobox's options and the matching lists' food rows, which each drew it on their own.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Facade — one label over `StatusBadge` and `VariantPartsLine`, so every list of options draws a tagged,
 *     parted name the same way
 */
import type { FC } from 'react';

import { StatusBadge } from '../statusBadge/StatusBadge.js';
import { VariantPartsLine } from '../variantPartsLine/VariantPartsLine.js';
import type { OptionLabelProps, OptionLabelSize } from './props.js';

/** Each size's type utility. */
const SIZE_CLASS: Readonly<Record<OptionLabelSize, string>> = { list: 'text-list', bodyMd: 'text-body-md' };

/** The web option label. */
export const OptionLabel: FC<OptionLabelProps> = ({ label, tag, detailParts, textSize }) => (
    // `min-w-0`: a column that cannot shrink below its parts line is how a dot came to start a line.
    <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`min-w-0 break-words text-ink ${SIZE_CLASS[textSize]}`}>{label}</span>
            {tag === undefined ? null : <StatusBadge status="note">{tag}</StatusBadge>}
        </span>
        {detailParts === undefined ? null : <VariantPartsLine parts={detailParts} tone="secondary" />}
    </span>
);
