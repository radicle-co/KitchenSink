'use client';

/**
 * @module CookingNoticeSlot — the one place on the web cooking surface where the route's offline notice is drawn.
 *
 * Cooking mode's package does not import `@commise/query`, so it cannot mount the notice itself. The route (which does)
 * hands the notice in through this slot, and `CookingFrame`, the one frame every cooking screen draws, puts it first in
 * the surface, above the top bar. That gives exactly one notice on Before you start, a step, All steps, Done and the
 * loading and notice screens, with no prop threaded through them. Without a provider the slot is empty.
 *
 * Presentational: props → JSX.
 *
 * @pattern Dependency Injection — the route supplies the notice; the frame only reads it
 */
import { createContext, useContext } from 'react';
import type { FC, ReactNode } from 'react';

const NoticeContext = createContext<ReactNode>(null);

/** Props for {@link CookingNoticeSlot}. */
interface CookingNoticeSlotProps {
    /** The notice the frame draws above its top bar. */
    readonly notice: ReactNode;
    readonly children: ReactNode;
}

/** Supplies the notice to every `CookingFrame` below. */
export const CookingNoticeSlot: FC<CookingNoticeSlotProps> = ({ notice, children }) => (
    <NoticeContext value={notice}>{children}</NoticeContext>
);

/** The notice the route supplied, or nothing. */
export function useCookingNotice(): ReactNode {
    return useContext(NoticeContext);
}
