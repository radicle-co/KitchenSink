/**
 * The reference sealer of a process with no remote search configured (ADR-0055 point 10). No remote hit is ever shown
 * there, so no reference was issued: every reference is unreadable, and a pick is answered as gone.
 *
 * @pattern Null Object — the reference sealer when `REMOTE_SEARCH_*` is absent
 * @module
 */
import { InvalidRemoteReferenceError } from './remoteReference.errors.js';
import type { RemoteFoodReference, RemoteReferenceSealer } from './RemoteReferenceSealer.js';

export class UnconfiguredReferenceSealer implements Pick<RemoteReferenceSealer, 'open' | 'seal'> {
    /**
     * @param _reference - The hit, which cannot exist here.
     * @throws {Error} always: with no remote search there is no remote hit to seal a reference for.
     */
    public async seal(_reference: RemoteFoodReference): Promise<string> {
        throw new Error('Remote search is not configured; no reference is sealed.');
    }

    /**
     * @param _token - The reference the app sent.
     * @throws {InvalidRemoteReferenceError} `unreadable`, always: this process issued no reference.
     */
    public async open(_token: string): Promise<never> {
        throw new InvalidRemoteReferenceError('unreadable');
    }
}
