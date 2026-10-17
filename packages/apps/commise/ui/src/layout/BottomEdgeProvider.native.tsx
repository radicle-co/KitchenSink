/**
 * @module @commise/ui/layout — publishes a bottom edge measured elsewhere: the navigator's tab bar, which a screen inside
 * a tab sits ABOVE, so the screen's own frame has no footer to measure. Popups opened in a modal window (the create
 * dial's menu) read it through `useBottomEdge` to clear the bar.
 *
 * Presentational: it hands a value down and draws nothing.
 *
 * @pattern Dependency Injection — the tab bar's measured height, injected through context
 */
import type { FC, ReactNode } from 'react';

import { BottomEdgeContext } from './bottomEdgeContext.native.js';

/** Publishes `value` as the bottom edge for everything below. */
export const BottomEdgeProvider: FC<{ readonly value: number; readonly children: ReactNode }> = ({
    value,
    children,
}) => <BottomEdgeContext.Provider value={value}>{children}</BottomEdgeContext.Provider>;
