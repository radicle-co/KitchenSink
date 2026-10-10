/**
 * @module @commise/features-recipes/hooks — the cook's own limit on source lookups, held ONCE above every surface that
 * spends it (`docs/design/rowEditorOpenDecisions.md` item 10, system change 9).
 *
 * Food caps the lookups one cook may spend. While that cap stands, a press on a remote food makes no request and repeats
 * the message instead (S7 list contract P8). A per-answer state would forget the limit at the next keystroke, so the
 * limit is one value for the session. It is held from a refused pick (`adoptRefusalOf`) and from a source frame that
 * reports the cook's limit (`useIngredientSuggestionSource`). Its pure rules are `sourceLimit.model.ts`'s.
 *
 * @pattern Headless hook — one session-wide value, read by every surface that spends the budget
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

/** The cook's limit, as the surfaces that spend the budget read it. */
export interface SourceLimit {
    /** When the limit ends, in epoch milliseconds; `undefined` while none is held. */
    readonly retryAt: number | undefined;
    /** Hold the limit until `retryAt`. A later time wins: an answer that arrives late cannot shorten a limit. */
    readonly hold: (retryAt: number) => void;
}

/**
 * The session's one source limit. It lets the limit go at the held time, so a surface reads `retryAt` and needs no clock.
 *
 * @returns The held limit; the same object until it changes.
 * @sideEffect Arms a timer that ends the limit at the held time.
 */
export function useSourceLimit(): SourceLimit {
    const [retryAt, setRetryAt] = useState<number | undefined>(undefined);
    const hold = useCallback((next: number): void => {
        setRetryAt((current) => (current !== undefined && current >= next ? current : next));
    }, []);

    useEffect(() => {
        if (retryAt === undefined) {
            return undefined;
        }

        const timer = setTimeout(
            () => setRetryAt((current) => (current === retryAt ? undefined : current)),
            Math.max(retryAt - Date.now(), 0),
        );

        return () => clearTimeout(timer);
    }, [retryAt]);

    return useMemo(() => ({ retryAt, hold }), [retryAt, hold]);
}
