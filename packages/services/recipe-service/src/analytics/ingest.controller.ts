/**
 * Analytics plan U4 — the client analytics door: `POST /ingest/v1/events` (origin R1, R12, R13; AE1–AE3).
 *
 * ## Off the domain contract, by MOUNT (KTD3)
 *
 * The contract parity filter admits only `health` and `api/*` controllers, so this `ingest/v1` mount is
 * invisible to it with zero guard exceptions — the domain OpenAPI never learns the route exists. The
 * payload zod comes from `@kitchensink/recipe-core`'s `analytics/event-payload` subpath (the ONE shared
 * home; clients import the same schema), and nothing under `src/analytics/` may be named `*.schema.ts`,
 * because contract discovery is deliberately blunt and would auto-publish it (pinned by the unit suite).
 *
 * ## What crosses this door
 *
 * ONLY the `query_outcome` family (R12's door binding): credit-bearing families (`recipe_saved`,
 * `recipe_viewed`, cooks when they exist) are server-observed ONLY, so a server-door type in a batch is
 * DROPPED and logged — the client cannot mint recognition credit. Validation is PER EVENT with
 * drop-and-log (one malformed event never voids the good ones beside it); a malformed ENVELOPE is a 400.
 * The actor is ALWAYS the verified bearer's principal — the payload has no actor field, structurally.
 *
 * ## Guards that apply here on purpose
 *
 * `AuthMiddleware` is `forRoutes('*')`, so this non-`api/` mount is bearer-protected with no wiring.
 * `ErasureLockGuard` answers 423 to a caller with an in-flight erasure — DESIGNED (KTD9): no new
 * user-keyed rows can land mid-sweep, closing the re-introduction race against the erasure UPDATE; the
 * fire-and-forget client emitter swallows the 423. Do not "fix" this with `@SkipErasureLock()`.
 *
 * ## The dedup-rate signal (KTD5)
 *
 * Each event carries a client-minted UUID, minted at OCCURRENCE — a minting bug (id minted at mount)
 * would silently drop everything after the first event, so the response reports accepted vs landed and
 * the controller logs the divergence. A dedup rate persistently above retry background noise is the
 * alarm. ⚠️ Accepted v1 risk (origin): pick data (query, position, provenance) is client-asserted and
 * unverifiable — acceptable while these numbers feed only internal SQL analysis; an integrity/anomaly
 * bar is owed before any automated ranking or user-visible use.
 */
import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';
import {
    MAX_EVENTS_PER_BATCH,
    queryOutcomeEventSchema,
    type QueryOutcomeEvent,
} from '@kitchensink/recipe-core/analytics/event-payload';

import { OwnerId } from '../auth/currentPrincipal.decorator.js';
import { AnalyticsIngestRateLimit } from '../common/throttle/throttle.decorators.js';
import { AnalyticsService } from './analytics.service.js';

/** The ingest door's response: how many events passed validation, and how many actually landed. */
export interface IngestResponse {
    readonly accepted: number;
    readonly landed: number;
}

@Controller('ingest/v1/events')
export class AnalyticsIngestController {
    private readonly logger = new Logger(AnalyticsIngestController.name);

    public constructor(private readonly analytics: AnalyticsService) {}

    /**
     * `POST /ingest/v1/events` — land a small batch of settled query outcomes.
     *
     * @param ownerId - The verified caller — the ONLY actor any event is attributed to.
     * @param body - The raw request body; the envelope is validated here, each event individually.
     * @returns Accepted vs landed counts (202 — the store is eventually consistent with the response).
     * @throws {BadRequestException} When the envelope is not a batch at all, or exceeds the batch cap.
     * @sideEffect Lands analytics rows; logs dropped events and dedup divergence.
     */
    @Post()
    @HttpCode(HttpStatus.ACCEPTED)
    @AnalyticsIngestRateLimit()
    public async ingest(@OwnerId() ownerId: string, @Body() body: unknown): Promise<IngestResponse> {
        const envelope = this.readEnvelope(body);
        const accepted: QueryOutcomeEvent[] = [];
        let dropped = 0;

        for (const candidate of envelope) {
            const parsed = queryOutcomeEventSchema.safeParse(candidate);

            if (parsed.success) {
                accepted.push(parsed.data);
            } else {
                // AE3/R12: dropped, logged, and harmless — a server-door family, a smuggled actor
                // field, or a malformed event never voids the valid events beside it.
                dropped += 1;
            }
        }

        if (dropped > 0) {
            this.logger.warn(`Analytics ingest dropped ${dropped} invalid/forbidden event(s) from a batch.`);
        }

        if (accepted.length === 0) {
            return { accepted: 0, landed: 0 };
        }

        const { landed, shed } = await this.analytics.ingestBatch(ownerId, accepted);

        if (!shed && landed < accepted.length) {
            // KTD5's visibility: retries are background noise; a PERSISTENT gap is the minting-bug alarm.
            this.logger.warn(
                `Analytics ingest dedup: ${accepted.length} accepted, ${landed} landed (${accepted.length - landed} duplicate id(s)).`,
            );
        }

        return { accepted: accepted.length, landed };
    }

    /** Validate the ENVELOPE shape only — a non-batch or over-cap request is the caller's error (400). */
    private readEnvelope(body: unknown): readonly unknown[] {
        if (typeof body !== 'object' || body === null || !Array.isArray((body as { events?: unknown }).events)) {
            throw new BadRequestException('Expected a body of shape { events: [...] }.');
        }

        const events = (body as { events: unknown[] }).events;

        if (events.length === 0 || events.length > MAX_EVENTS_PER_BATCH) {
            throw new BadRequestException(`Expected 1..${MAX_EVENTS_PER_BATCH} events per batch.`);
        }

        return events;
    }
}
