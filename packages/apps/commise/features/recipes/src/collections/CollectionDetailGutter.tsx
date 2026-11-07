/**
 * @module @commise/features-recipes/collections — the side gutter around the parts of the collection detail that come
 * after its header (web). The page already pads its content, so this passes its children straight through. The native
 * twin pads them 16 pt, because there the screen's scroller does not and the large title insets only itself.
 *
 * Presentational: props → JSX.
 */
import type { FC, ReactNode } from 'react';

/** Props for {@link CollectionDetailGutter}. */
export interface CollectionDetailGutterProps {
    /** What sits in the gutter. */
    readonly children: ReactNode;
}

export const CollectionDetailGutter: FC<CollectionDetailGutterProps> = ({ children }) => <>{children}</>;
