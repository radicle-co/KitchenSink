/**
 * @module fixtures/Diverged — the native leaf of the diverged pair. Presentational.
 */
import type { FC } from 'react';

/** Props for the native {@link Diverged} leaf. */
export interface DivergedNativeProps {
    /** Shared on both leaves. */
    readonly label: string;
    /** Native only. */
    readonly onPress: () => void;
}

/** The native leaf. */
export const Diverged: FC<DivergedNativeProps> = ({ label, onPress }) => <span onClick={onPress}>{label}</span>;
