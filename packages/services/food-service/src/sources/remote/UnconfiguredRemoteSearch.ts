/**
 * The remote search of a process with no search service configured (local development, and every suite that does not
 * stand one up): every source answers `unavailable`, so the cook is told the source did not answer and never sees a
 * silent empty answer (ADR-0055 point 9).
 *
 * @pattern Null Object — the `RemoteSearchPort` when `REMOTE_SEARCH_*` is absent
 * @module
 */
import type { RemoteSearchPort, RemoteSourceOutcome } from './remoteSearchPort.js';

export class UnconfiguredRemoteSearch implements RemoteSearchPort {
    /**
     * @returns `unavailable`, for every source. Pure.
     */
    public async search(): Promise<RemoteSourceOutcome> {
        return { kind: 'unavailable' };
    }
}
