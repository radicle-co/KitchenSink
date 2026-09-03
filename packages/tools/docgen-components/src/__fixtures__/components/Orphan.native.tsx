/**
 * @module fixtures/Orphan — a NATIVE-only leaf with no web sibling, which the cross-platform rule
 * (`docs/CODING_STANDARDS.md` §14) makes a reportable finding rather than a silent omission.
 */
import type { FC } from 'react';

/** Props for {@link Orphan}. */
export interface OrphanProps {
    /** Visible caption. */
    readonly caption: string;
}

/** A native-only presentational leaf. */
export const Orphan: FC<OrphanProps> = ({ caption }) => <span>{caption}</span>;
