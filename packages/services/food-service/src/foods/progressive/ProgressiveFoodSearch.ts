/**
 * The progressive food search (ADR-0055 points 4, 5 and 9; review rulings 1 and 4; finding 7): the one search the apps
 * read, answered as frames while it runs.
 *
 * 1. Every remote source is asked at once, and our database's two reads run beside them.
 * 2. The `database` frame is written first: the same catalog and authored reads S3's routes answer with, each group
 *    with its own outcome, so one failing never hides the other. A group not read by
 *    {@link DATABASE_FRAME_DEADLINE_MS} from the request is unavailable.
 * 3. Each source's frame follows as that source settles, after the database frame. An answered source is triaged
 *    against the catalog (`remoteHitTriage.ts`): what the catalog holds or retired, or a live root holding a record
 *    already carries by name, is hidden, and each hit shown carries the name its root will carry and a sealed
 *    reference.
 * 4. Each source's frame is closed by {@link REMOTE_FRAME_DEADLINE_MS} from the request, as unavailable when it has
 *    not settled or its triage has not finished. The call behind it is not cancelled: an admitted fetch runs to
 *    completion and fills the cache.
 * 5. `complete` is written last. Once the caller has gone, nothing more is written.
 * 6. The search gaps every answered source found are recorded after `complete`, so a gap write never holds the answer
 *    back, and one that fails is logged and never fails the search.
 *
 * Validation, authentication and the per-minute cap all run before this, so every failure here is a frame.
 *
 * @pattern Facade — the database reads, the remote search port, the owner reader, the named-root read, the sealer and
 *   the gap recorder behind one run
 * @pattern Scatter-Gather — every source asked at once, each answer written as it arrives, each closed by a deadline
 * @module
 */
import { Logger } from '@nestjs/common';
import { meetsSearchMinimum } from '@kitchensink/recipe-core/resolution/search-minimum';
import { isLineageKey } from '@kitchensink/usda-client';
import type { RemoteSearchItem, RemoteSearchSource } from '@kitchensink/schema-remote-search';

import type { RemoteSearchPort, RemoteSourceOutcome } from '../../sources/remote/remoteSearchPort.js';
import { REMOTE_SEARCH_SOURCES } from '../../sources/remote/remoteSearchSources.js';
import type { CatalogOwnerReader, SourceKeyRef } from '../catalogOwnerReader.service.js';
import type { RemoteAdoptionDao } from '../dao/remoteAdoption.dao.js';
import { triageRemoteHits, type SearchGap } from '../domain/remoteHitTriage.js';
import type { FoodsService } from '../foods.service.js';
import type {
    CatalogGroup,
    DatabaseFrame,
    ProgressiveSearchFrame,
    RemoteFoodView,
    SourceFrame,
} from '../progressiveSearch.schema.js';
import type { RemoteReferenceSealer } from '../remote/RemoteReferenceSealer.js';
import { remoteRootKeyOf, remoteRootNameOf } from '../remote/remoteRootName.js';
import type { SearchGapRecorder } from '../SearchGapRecorder.js';

/**
 * How long after the request each source's frame may stay open, in milliseconds: inside the app's 10 s budget for the
 * whole answer (`rowEditorOpenDecisions.md` P3), with room for the database frame and the line to the device.
 */
export const REMOTE_FRAME_DEADLINE_MS = 8_000;

/**
 * How long after the request the database frame's reads may take, in milliseconds: inside the 3 s the apps give the
 * database frame (`FOOD_SEARCH_DEADLINE_MS` in `@commise/features-recipes`), with room for the line to the device.
 */
export const DATABASE_FRAME_DEADLINE_MS = 2_000;

/**
 * The most hits of one source triaged and shown. The source's page bounds it today (`USDA_SEARCH_PAGE_SIZE`); the cap
 * keeps a larger page from a later source from growing the catalog read and the sealing, cut before either.
 */
export const REMOTE_FRAME_ITEM_LIMIT = 20;

/** One search. */
export interface ProgressiveSearchRequest {
    /** The canonical term (`searchTermQuerySchema`). */
    readonly term: string;
    /** The requester key a remote miss is charged to: an app-user ULID or a `svc_*` id. */
    readonly requesterId: string;
    /** The caller's app-user ULID, whose authored foods are read; `undefined` for a service, which authored none. */
    readonly authorId: string | undefined;
    /** Aborts when the caller goes. */
    readonly signal: AbortSignal;
}

/** Where the frames go, in order. */
export interface FrameSink {
    /** @sideEffect Writes one frame to the caller. */
    write(frame: ProgressiveSearchFrame): void;
}

/** Where the search reports a fault. Nest's `Logger` satisfies it. */
export interface ProgressiveSearchLogger {
    warn(message: string, context?: Record<string, unknown>): void;
    error(message: string, context?: Record<string, unknown>): void;
}

/** What the search is built over. */
export interface ProgressiveFoodSearchDeps {
    /** S3's two reads (review ruling 4). */
    readonly database: Pick<FoodsService, 'searchCatalog' | 'searchAuthored'>;
    readonly remote: RemoteSearchPort;
    /** The one definition of "held" (ADR-0055 point 4). */
    readonly owners: Pick<CatalogOwnerReader, 'standingOfKeys'>;
    /** The live catalog roots carrying the hits' root names, read as the remote pick reads them. */
    readonly namedRoots: Pick<RemoteAdoptionDao, 'liveCatalogRootsNamed'>;
    readonly sealer: Pick<RemoteReferenceSealer, 'seal'>;
    readonly gaps: Pick<SearchGapRecorder, 'record'>;
    /** Every source to ask. Defaults to every source the search service searches. */
    readonly sources?: readonly RemoteSearchSource[];
    /** Defaults to {@link REMOTE_FRAME_DEADLINE_MS}. */
    readonly frameDeadlineMs?: number;
    /** Defaults to {@link DATABASE_FRAME_DEADLINE_MS}. */
    readonly databaseDeadlineMs?: number;
    /** Defaults to a Nest `Logger`. */
    readonly logger?: ProgressiveSearchLogger;
}

/** A source's frame, and the gaps to record once the search is complete. */
interface SourceAnswer {
    readonly frame: SourceFrame;
    readonly gaps: readonly SearchGap[];
}

/** A database group that could not be read. */
const UNAVAILABLE_GROUP = { outcome: 'unavailable' } as const;

/**
 * A promise, or what the signal says once it aborts first.
 *
 * @param work - The promise, which keeps running either way.
 * @param signal - The signal.
 * @param onAbort - The value when the signal aborts first.
 * @returns Whichever settles first.
 */
async function untilAborted<T>(work: Promise<T>, signal: AbortSignal, onAbort: T): Promise<T> {
    if (signal.aborted) {
        return onAbort;
    }

    return new Promise<T>((resolve, reject) => {
        const aborted = (): void => {
            resolve(onAbort);
        };

        signal.addEventListener('abort', aborted, { once: true });
        work.then(
            (value) => {
                signal.removeEventListener('abort', aborted);
                resolve(value);
            },
            (error: unknown) => {
                signal.removeEventListener('abort', aborted);
                reject(error);
            },
        );
    });
}

/**
 * A remote hit's key, with its lineage key when it is one the catalog can hold. Any other form matches nothing in the
 * catalog (its lineage column admits only that form), so dropping it loses no match. Pure.
 *
 * @param item - The hit.
 * @returns Its key.
 */
function keyRefOf(item: RemoteSearchItem): SourceKeyRef {
    return { externalKey: item.externalKey, lineageKey: isLineageKey(item.lineageKey) ? item.lineageKey : null };
}

/**
 * The roots the catalog group shows, or `undefined` when it could not be read. Pure.
 *
 * @param catalog - The group.
 * @returns The root ids.
 */
function rootIdsOf(catalog: CatalogGroup): ReadonlySet<string> | undefined {
    return catalog.outcome === 'answered' ? new Set(catalog.results.map((result) => result.id)) : undefined;
}

export class ProgressiveFoodSearch {
    private readonly sources: readonly RemoteSearchSource[];
    private readonly frameDeadlineMs: number;
    private readonly databaseDeadlineMs: number;
    private readonly logger: ProgressiveSearchLogger;

    /**
     * @param deps - The reads, the remote port, the owner reader, the named-root read, the sealer, the gap recorder and
     *   the seams.
     */
    public constructor(private readonly deps: ProgressiveFoodSearchDeps) {
        this.sources = deps.sources ?? REMOTE_SEARCH_SOURCES;
        this.frameDeadlineMs = deps.frameDeadlineMs ?? REMOTE_FRAME_DEADLINE_MS;
        this.databaseDeadlineMs = deps.databaseDeadlineMs ?? DATABASE_FRAME_DEADLINE_MS;
        this.logger = deps.logger ?? new Logger(ProgressiveFoodSearch.name);
    }

    /**
     * Run one search, writing its frames.
     *
     * @param request - The term, the requester, the author and the caller's signal.
     * @param sink - Where the frames go.
     * @returns When every frame is written, or the caller has gone, and the search gaps are recorded.
     * @sideEffect Reads the catalog and the caller's foods; may call the search service, charge the requester's budget
     *   and the shared window, and record search gaps; writes frames.
     */
    public async run(request: ProgressiveSearchRequest, sink: FrameSink): Promise<void> {
        const write = (frame: ProgressiveSearchFrame): void => {
            if (!request.signal.aborted) {
                sink.write(frame);
            }
        };

        const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(this.frameDeadlineMs)]);
        const remote = this.sources.map((source) => ({ source, outcome: this.askSource(request, source, deadline) }));
        const databaseWritten = this.readDatabase(request).then((frame) => {
            write(frame);

            return rootIdsOf(frame.catalog);
        });

        const answers = await Promise.all(
            remote.map(async ({ source, outcome }) => {
                const answer = await this.sourceAnswer(
                    request.term,
                    source,
                    await outcome,
                    await databaseWritten,
                    deadline,
                );

                write(answer.frame);

                return { source, gaps: answer.gaps };
            }),
        );

        write({ type: 'complete' });

        await Promise.all(answers.map(async ({ source, gaps }) => this.recordGaps(source, gaps)));
    }

    /**
     * Record one source's search gaps, logging a failure: a gap is a curator's signal, never part of the answer.
     *
     * @param source - The source the gaps came from.
     * @param gaps - Its gaps.
     * @sideEffect Records the gaps; logs a failure.
     */
    private async recordGaps(source: RemoteSearchSource, gaps: readonly SearchGap[]): Promise<void> {
        if (gaps.length === 0) {
            return;
        }

        try {
            await this.deps.gaps.record(source, gaps);
        } catch (error) {
            this.logger.error('progressive-search-gap-record-failed', { source, cause: String(error) });
        }
    }

    /**
     * Ask one source, answering unavailable when it has not settled by the deadline. The call itself keeps running.
     *
     * @param request - The search.
     * @param source - The source.
     * @param deadline - Aborts at the deadline or when the caller goes.
     * @returns The source's outcome.
     * @sideEffect May call the search service and charge admission.
     */
    private async askSource(
        request: ProgressiveSearchRequest,
        source: RemoteSearchSource,
        deadline: AbortSignal,
    ): Promise<RemoteSourceOutcome> {
        if (!meetsSearchMinimum(request.term)) {
            // A term below the search minimum has no remote meaning (003-FR-010a), as S3's reads answer it.
            return { kind: 'answered', items: [] };
        }

        const unavailable: RemoteSourceOutcome = { kind: 'unavailable' };
        const outcome = this.deps.remote
            .search({ source, term: request.term, requesterId: request.requesterId, signal: deadline })
            .catch((error: unknown) => {
                // The port answers every ending as an outcome; a rejection is a defect, never the source's.
                this.logger.error('progressive-search-remote-failed', { source, cause: String(error) });

                return unavailable;
            });

        return untilAborted(outcome, deadline, unavailable);
    }

    /**
     * The database frame: S3's catalog and authored reads, each with its own outcome and its own bound. A read still
     * running at the deadline is not cancelled; it holds its connection until it ends.
     *
     * @param request - The search.
     * @returns The frame, by {@link DATABASE_FRAME_DEADLINE_MS} from the request.
     * @sideEffect Reads `food`; logs a failed or late read.
     */
    private async readDatabase(request: ProgressiveSearchRequest): Promise<DatabaseFrame> {
        const deadline = AbortSignal.timeout(this.databaseDeadlineMs);
        const [catalog, authored] = await Promise.all([
            this.groupWithin('catalog', this.deps.database.searchCatalog(request.term), deadline),
            request.authorId === undefined
                ? { outcome: 'answered' as const, results: [] }
                : this.groupWithin(
                      'authored',
                      this.deps.database.searchAuthored(request.term, request.authorId),
                      deadline,
                  ),
        ]);

        return { type: 'database', catalog, authored };
    }

    /**
     * One database group's outcome: its results, or unavailable when its read failed or the deadline came first.
     *
     * @param group - Which group, for the log.
     * @param read - Its read.
     * @param deadline - Aborts at the database frame's deadline.
     * @returns The group.
     * @sideEffect Logs a failed or late read.
     */
    private async groupWithin<Result>(
        group: 'catalog' | 'authored',
        read: Promise<{ readonly results: readonly Result[] }>,
        deadline: AbortSignal,
    ): Promise<{ readonly outcome: 'answered'; readonly results: Result[] } | typeof UNAVAILABLE_GROUP> {
        const settled = read.then(
            (value) => ({ outcome: 'answered' as const, results: [...value.results] }),
            (error: unknown) => {
                this.logger.error('progressive-search-database-failed', { group, cause: String(error) });

                return UNAVAILABLE_GROUP;
            },
        );
        const answered = await untilAborted(settled, deadline, undefined);

        if (answered === undefined) {
            this.logger.warn('progressive-search-database-deadline', { group });

            return UNAVAILABLE_GROUP;
        }

        return answered;
    }

    /**
     * A source's frame and its gaps.
     *
     * @param term - The canonical term.
     * @param source - The source.
     * @param outcome - How the source's search ended.
     * @param catalogRootIds - The roots the database frame shows, or `undefined` when its catalog read failed.
     * @param deadline - Aborts at the frame deadline or when the caller goes; an unfinished triage is then unavailable.
     * @returns The frame and the gaps to record.
     * @sideEffect Reads the catalog's standing for the hits and seals references; logs a failure.
     */
    private async sourceAnswer(
        term: string,
        source: RemoteSearchSource,
        outcome: RemoteSourceOutcome,
        catalogRootIds: ReadonlySet<string> | undefined,
        deadline: AbortSignal,
    ): Promise<SourceAnswer> {
        switch (outcome.kind) {
            case 'busy':
            case 'limited':
                return {
                    frame: {
                        type: 'source',
                        source,
                        outcome: outcome.kind,
                        retryAfterSeconds: outcome.retryAfterSeconds,
                    },
                    gaps: [],
                };
            case 'unavailable':
                return { frame: { type: 'source', source, outcome: 'unavailable' }, gaps: [] };

            case 'answered':
                return this.triagedWithin(term, source, outcome.items, catalogRootIds, deadline);
        }
    }

    /**
     * An answered source's frame, or unavailable when its triage fails or the deadline comes first. A triage still
     * running then is not cancelled, and its gaps are not recorded.
     *
     * @param term - The canonical term.
     * @param source - The source.
     * @param items - Its hits, in its order.
     * @param catalogRootIds - The roots the database frame shows, or `undefined`.
     * @param deadline - Aborts at the frame deadline or when the caller goes.
     * @returns The frame and the gaps.
     * @sideEffect Reads the catalog's standing for the hits and seals references; logs a failed or late triage.
     */
    private async triagedWithin(
        term: string,
        source: RemoteSearchSource,
        items: readonly RemoteSearchItem[],
        catalogRootIds: ReadonlySet<string> | undefined,
        deadline: AbortSignal,
    ): Promise<SourceAnswer> {
        const unavailable: SourceAnswer = { frame: { type: 'source', source, outcome: 'unavailable' }, gaps: [] };
        const triaged = this.answeredFrame(term, source, items, catalogRootIds).catch((error: unknown) => {
            this.logger.error('progressive-search-triage-failed', { source, cause: String(error) });

            return unavailable;
        });
        const answer = await untilAborted(triaged, deadline, undefined);

        if (answer === undefined) {
            this.logger.warn('progressive-search-triage-deadline', { source });

            return unavailable;
        }

        return answer;
    }

    /**
     * An answered source's frame: its hits the catalog does not hold, each sealed, and its gaps.
     *
     * @param term - The canonical term.
     * @param source - The source.
     * @param items - Its hits, in its order.
     * @param catalogRootIds - The roots the database frame shows, or `undefined`.
     * @returns The frame and the gaps.
     * @throws When the catalog cannot be read or a reference cannot be sealed.
     * @sideEffect Reads the catalog's standing for the hits and the roots carrying their names; seals references.
     */
    private async answeredFrame(
        term: string,
        source: RemoteSearchSource,
        items: readonly RemoteSearchItem[],
        catalogRootIds: ReadonlySet<string> | undefined,
    ): Promise<SourceAnswer> {
        const asked = items.slice(0, REMOTE_FRAME_ITEM_LIMIT);
        const [standing, namedRoots] = await Promise.all([
            this.deps.owners.standingOfKeys(source, asked.map(keyRefOf)),
            this.deps.namedRoots.liveCatalogRootsNamed(asked.map((item) => remoteRootKeyOf(item.name))),
        ]);
        const triage = triageRemoteHits({ query: term, source, items: asked, standing, namedRoots, catalogRootIds });
        const shown = await Promise.all(triage.shown.map(async (item) => this.viewOf(source, item)));

        return {
            frame: {
                type: 'source',
                source,
                outcome: 'answered',
                items: shown.flatMap((view) => (view === undefined ? [] : [view])),
            },
            gaps: triage.gaps,
        };
    }

    /**
     * A shown hit as the wire carries it, or `undefined` when its name has nothing visible to give a root.
     *
     * @param source - The source.
     * @param item - The hit.
     * @returns Its view.
     * @sideEffect Seals a reference.
     */
    private async viewOf(source: RemoteSearchSource, item: RemoteSearchItem): Promise<RemoteFoodView | undefined> {
        const name = remoteRootNameOf(item.name);

        if (name === '') {
            return undefined;
        }

        const { externalKey, lineageKey } = keyRefOf(item);

        return { name, reference: await this.deps.sealer.seal({ source, externalKey, lineageKey, name }) };
    }
}
