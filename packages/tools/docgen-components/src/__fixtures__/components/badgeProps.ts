/**
 * @module fixtures/badgeProps — the shared prop contract for the `Badge` fixture pair, mirroring how
 * `@commise/ui` puts a cross-platform contract in its own module beside the two leaves.
 */
import type { ReactNode } from 'react';

/** Visual tier. */
export type BadgeTone = 'neutral' | 'success' | 'warning';

/** The cross-platform Badge contract shared by both fixture leaves. */
export interface BadgeProps {
    /** Visual tier. Defaults to `neutral`. */
    readonly tone?: BadgeTone;
    /** The visible label, which also owns the accessible name. */
    readonly children: ReactNode;
    /** Renders the compact form. */
    readonly compact?: boolean;
}
