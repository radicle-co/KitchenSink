/**
 * @module fixtures/Diverged — the web leaf of a pair whose two leaves declare DIFFERENT props. Presentational.
 */
import type { FC } from 'react';

/** Props for the web {@link Diverged} leaf. */
export interface DivergedWebProps {
    /** Shared on both leaves. */
    readonly label: string;
    /** Web only. */
    readonly href: string;
}

/** The web leaf. */
export const Diverged: FC<DivergedWebProps> = ({ label, href }) => <a href={href}>{label}</a>;
