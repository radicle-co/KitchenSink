/**
 * The remote pick (ADR-0055 points 4 and 10; review ruling 9): turn a remote hit the cook picked into the catalog root
 * that stands for it, and answer that root's id. The app then commits the line as it commits any catalog pick.
 *
 * 1. Open the reference food issued with the hit. One it cannot open is gone: the cook searches again.
 * 2. Ask the catalog owner reader, the one definition of "held", with the item's lineage, as the search did: a held
 *    item answers its root, and an item the catalog retired with no forward is gone.
 * 3. A live catalog root that already carries the picked name and holds a record answers too: a catalog name is unique
 *    among live roots. Search hides such a hit by the same rule (`remoteHitTriage.ts`). A placeholder carrying it
 *    (`namedRootPolicy.ts`) is completed with the picked item instead, so a pick never binds a line to a root with no
 *    data. Its queue row is leased first, so no drain fetches for it while the pick does; while a drain holds the row
 *    the pick answers busy and fetches nothing.
 * 4. Fetch the item ONCE, through the API's rate-limited transport on the interactive lane. The route charges the
 *    cook's hourly budget for that call and gives it back when none was made (`AdoptRateLimit`). It is never retried
 *    here (R65).
 * 5. Write the root (a new one under the picked name, or the placeholder) with the source pipeline's own merge writer,
 *    in one transaction with a lock per item (`RemoteAdoptionDao`), settling the placeholder's queue under the lease. A
 *    writer that got there first means its root is the answer. A lease the write did not settle is given back, due at
 *    once.
 *
 * Idempotent on the source and the key: every later pick of the item finds it held at step 2.
 *
 * @pattern Command — one remote pick, idempotent on its natural key
 * @module
 */
import { Logger } from '@nestjs/common';

import type { CanonicalCandidate, FoodSourceAdapter } from '../../sources/foodSourceAdapter.js';
import {
    isAdapterValidationError,
    isSourceAccountingError,
    isSourceApiError,
    isSourceBusyError,
} from '../../sources/foodSource.errors.js';
import type { SourceAdapterRegistry } from '../../sources/SourceAdapterRegistry.js';
import { secondsUntil } from '../../sources/transport/secondsUntil.js';
import type { FoodWriter } from '../../database/unitOfWork.js';
import type { CatalogOwnerReader, KeyStanding } from '../catalogOwnerReader.service.js';
import type { FetchQueueDao } from '../dao/fetchQueue.dao.js';
import { isLeaseLostError } from '../dao/leaseFence.js';
import type { AdoptionLease, AdoptionWrite, RemoteAdoptionDao } from '../dao/remoteAdoption.dao.js';
import { answersItsName } from '../domain/namedRootPolicy.js';
import { FetchUnavailableError, RemoteFoodGoneError } from '../foods.errors.js';
import type { AdoptRemoteFoodResponse } from '../foods.schema.js';
import { isInvalidRemoteReferenceError } from './remoteReference.errors.js';
import type { RemoteFoodReference, RemoteReferenceSealer } from './RemoteReferenceSealer.js';
import { remoteRootKeyOf, remoteRootNameOf } from './remoteRootName.js';

/** The wait a cook is told when the fetch failed for a reason that names none, in seconds. */
const ADOPT_RETRY_AFTER_SECONDS = 30;

/** What a cook is told while a drain fetches for the root the pick would complete. */
const BEING_FETCHED = 'This food is being fetched; try again shortly';

/** The wait a cook is told while a drain fetches for the root the pick would complete, in seconds: one fetch. */
const DRAIN_RETRY_AFTER_SECONDS = 5;

/** Where the command reports a refused reference. Nest's `Logger` satisfies it. */
export interface AdoptLogger {
    warn(message: string, context?: Record<string, unknown>): void;
}

/** What the command is built over. */
export interface AdoptRemoteFoodDeps {
    readonly sealer: Pick<RemoteReferenceSealer, 'open'>;
    readonly owners: Pick<CatalogOwnerReader, 'standingOfKeys'>;
    /** The API's registry: every fetch goes through the rate-limited transport on the interactive lane. */
    readonly registry: Pick<SourceAdapterRegistry, 'adapterFor'>;
    readonly adoption: Pick<RemoteAdoptionDao, 'liveCatalogRootNamed' | 'adopt'>;
    /** The fetch queue: a placeholder's row is leased before the fetch, and given back when the write did not settle it. */
    readonly queue: Pick<FetchQueueDao, 'leaseFood' | 'deferLease'>;
    /** How a new root's record is written from the fetched item: the source pipeline's merge writer. */
    readonly persistRoot: (candidate: CanonicalCandidate) => (writer: FoodWriter, foodId: string) => Promise<void>;
    /** The current time, epoch milliseconds. Defaults to `Date.now`. */
    readonly now?: () => number;
    /** Defaults to a Nest `Logger`. */
    readonly logger?: AdoptLogger;
}

export class AdoptRemoteFood {
    private readonly now: () => number;
    private readonly logger: AdoptLogger;

    /** @param deps - The sealer, the owner reader, the registry, the adoption write and its record writer. */
    public constructor(private readonly deps: AdoptRemoteFoodDeps) {
        this.now = deps.now ?? Date.now;
        this.logger = deps.logger ?? new Logger(AdoptRemoteFood.name);
    }

    /**
     * Pick a remote hit by its reference.
     *
     * @param token - The reference the hit carried.
     * @returns The id of the root that stands for the item.
     * @throws {RemoteFoodGoneError} when the reference cannot be opened, the catalog retired the item with no forward,
     *   the source no longer has it, or its data cannot be stored.
     * @throws {FetchUnavailableError} when the source is busy or did not answer, our own accounting failed, or a drain
     *   is fetching for the placeholder the pick would complete.
     * @sideEffect Reads the catalog; may lease a placeholder's queue row, call the source once, and write a root.
     */
    public async execute(token: string): Promise<AdoptRemoteFoodResponse> {
        const reference = await this.open(token);
        const held = this.answerOf(await this.standingOf(reference), reference);

        if (held !== undefined) {
            return held;
        }

        const name = remoteRootNameOf(reference.name);
        const normalizedName = remoteRootKeyOf(reference.name);

        if (name === '') {
            throw new RemoteFoodGoneError();
        }

        const named = await this.deps.adoption.liveCatalogRootNamed(normalizedName);

        if (named !== undefined && answersItsName(named.status)) {
            return { id: named.id };
        }

        const lease = named === undefined ? undefined : await this.leaseOf(named.id);
        let unsettled = lease;

        try {
            const candidate = { ...(await this.fetch(reference)), name };
            const write = await this.deps.adoption.adopt({
                source: reference.source,
                externalKey: reference.externalKey,
                name,
                normalizedName,
                lease,
                persistRoot: this.deps.persistRoot(candidate),
            });

            if (write.kind === 'completed' && write.id === lease?.rootId) {
                unsettled = undefined;
            }

            return await this.answerOfWrite(write, reference);
        } catch (error) {
            if (isLeaseLostError(error)) {
                // A drain took the row back (a reap, or a worker's shutdown release): its fetch is the one that counts.
                unsettled = undefined;

                throw new FetchUnavailableError(DRAIN_RETRY_AFTER_SECONDS, BEING_FETCHED);
            }

            throw error;
        } finally {
            if (unsettled !== undefined) {
                await this.release(unsettled);
            }
        }
    }

    /**
     * Lease a placeholder's queue row before fetching for it.
     *
     * @param rootId - The placeholder.
     * @returns The lease, or `undefined` when no drain would take the row (no row, or a tombstone).
     * @throws {FetchUnavailableError} while a drain holds the row: the pick fetches nothing.
     * @sideEffect May update `fetch_queue`.
     */
    private async leaseOf(rootId: string): Promise<AdoptionLease | undefined> {
        const lease = await this.deps.queue.leaseFood(rootId);

        if (lease.kind === 'draining') {
            throw new FetchUnavailableError(DRAIN_RETRY_AFTER_SECONDS, BEING_FETCHED);
        }

        return lease.kind === 'leased' ? { rootId, fence: lease.fence } : undefined;
    }

    /**
     * Give a lease the write did not settle back, due at once, so a drain takes the row as if the pick never had.
     *
     * @param lease - The lease.
     * @sideEffect Updates `fetch_queue`; logs a release that failed, which the reaper heals after the lease window.
     */
    private async release(lease: AdoptionLease): Promise<void> {
        try {
            await this.deps.queue.deferLease(lease.rootId, 0, lease.fence);
        } catch (error) {
            this.logger.warn('remote-adopt-lease-release-failed', {
                foodId: lease.rootId,
                leaseLost: isLeaseLostError(error),
            });
        }
    }

    /**
     * The answer an adoption write gives.
     *
     * @param write - How the write ended.
     * @param reference - The item.
     * @returns The root that stands for the item.
     * @throws {FetchUnavailableError} when a drain took the placeholder meanwhile.
     * @throws {RemoteFoodGoneError} when the item was crosswalked to a root the catalog then retired with no forward.
     * @sideEffect Reads the catalog when another writer crosswalked the item.
     */
    private async answerOfWrite(
        write: AdoptionWrite,
        reference: RemoteFoodReference,
    ): Promise<AdoptRemoteFoodResponse> {
        if (write.kind === 'draining') {
            throw new FetchUnavailableError(DRAIN_RETRY_AFTER_SECONDS, BEING_FETCHED);
        }

        if (write.kind !== 'crosswalked') {
            return { id: write.id };
        }

        // Another writer crosswalked the item while it was fetched: its root, as the catalog now says, is the answer.
        const answer = this.answerOf(await this.standingOf(reference), reference);

        if (answer === undefined) {
            throw new RemoteFoodGoneError();
        }

        return answer;
    }

    /**
     * Open a reference, answering one that cannot be opened as gone.
     *
     * @param token - The reference.
     * @returns What it names.
     * @throws {RemoteFoodGoneError} when it cannot be opened.
     * @sideEffect Logs why a reference was refused.
     */
    private async open(token: string): Promise<RemoteFoodReference> {
        try {
            return await this.deps.sealer.open(token);
        } catch (error) {
            if (isInvalidRemoteReferenceError(error)) {
                this.logger.warn('remote-adopt-reference-refused', { reason: error.reason });

                throw new RemoteFoodGoneError();
            }

            throw error;
        }
    }

    /**
     * The catalog's standing for the referenced item.
     *
     * @param reference - The item.
     * @returns Its standing.
     * @sideEffect Reads the catalog through the owner reader.
     */
    private async standingOf(reference: RemoteFoodReference): Promise<KeyStanding> {
        return this.deps.owners.standingOfKeys(reference.source, [
            { externalKey: reference.externalKey, lineageKey: reference.lineageKey },
        ]);
    }

    /**
     * The answer the catalog's standing gives, if any. Pure.
     *
     * @param standing - The item's standing.
     * @param reference - The item.
     * @returns The holding root's id, or `undefined` when the catalog does not hold the item.
     * @throws {RemoteFoodGoneError} when the catalog retired the item with no forward.
     */
    private answerOf(standing: KeyStanding, reference: RemoteFoodReference): AdoptRemoteFoodResponse | undefined {
        const owner = standing.owners.get(reference.externalKey);

        if (owner !== undefined) {
            return { id: owner.rootId };
        }

        if (standing.retired.has(reference.externalKey)) {
            throw new RemoteFoodGoneError();
        }

        return undefined;
    }

    /**
     * Fetch the item once, and check it is the one the reference names.
     *
     * @param reference - The item.
     * @returns Its canonical candidate.
     * @throws {FetchUnavailableError} or {@link RemoteFoodGoneError}, as {@link failureOf} classifies a failure.
     * @throws {Error} when the source answered with another item: a defect of the adapter.
     * @sideEffect Calls the source through the rate-limited transport.
     */
    private async fetch(reference: RemoteFoodReference): Promise<CanonicalCandidate> {
        const adapter: FoodSourceAdapter = this.deps.registry.adapterFor(reference.source);
        let candidate: CanonicalCandidate;

        try {
            candidate = await adapter.fetchByKey(reference.externalKey);
        } catch (error) {
            throw this.failureOf(error);
        }

        if (candidate.source !== reference.source || candidate.externalKey !== reference.externalKey) {
            throw new Error(
                `The source answered ${reference.source}:${reference.externalKey} with not the item asked for.`,
            );
        }

        return candidate;
    }

    /**
     * What a fetch failure tells the cook. Pure but for the clock.
     *
     * @param error - The failure.
     * @returns The error to throw: busy for as long as a refusal says, gone when the item cannot be had, the failure
     *   itself when it is not the source's or the transport's.
     */
    private failureOf(error: unknown): unknown {
        if (isSourceBusyError(error)) {
            return new FetchUnavailableError(secondsUntil(error.retryAt, this.now()));
        }

        if (isSourceAccountingError(error)) {
            return new FetchUnavailableError(ADOPT_RETRY_AFTER_SECONDS);
        }

        if ((isSourceApiError(error) && error.statusCode === 404) || isAdapterValidationError(error)) {
            return new RemoteFoodGoneError();
        }

        if (isSourceApiError(error)) {
            return new FetchUnavailableError(ADOPT_RETRY_AFTER_SECONDS, 'The source did not answer; food unchanged');
        }

        return error;
    }
}
