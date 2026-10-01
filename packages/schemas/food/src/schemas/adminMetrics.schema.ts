/*
 * ⚠️ GENERATED FILE — DO NOT EDIT.
 *
 * Copied verbatim from the food (ingredient) service, which AUTHORS the wire contract. Edit the
 * source and regenerate: `npm run contract:generate --workspace=@kitchensink/food-service`.
 *
 * CI fails on any difference between this directory and a fresh regeneration, so a hand-edit here is
 * discarded rather than shipped.
 */
// Source: packages/services/food-service/src/foods/admin/adminMetrics.schema.ts

/**
 * THE ADMIN OPERATIONAL-METRICS WIRE CONTRACT for `/api/v1/foods/admin/*` (T-184, FR-039/US-10) — authored
 * here and copied into `@kitchensink/schema-food` (`docs/CODING_STANDARDS.md` §15.2).
 *
 * These shapes were previously defined as interfaces spread across the DAO
 * (`adminMetrics.dao.ts`: `QueueDepthMetrics`, `BacklogMetrics`) and the service
 * (`adminMetrics.service.ts`: `SourceWindowMetrics`, `OperationalMetrics`), i.e. the wire contract of two
 * admin endpoints was defined by its data-access layer. That is the same leak §15.2 records for recipe's
 * search facets, and it is why the types now originate here and the DAO/service import them.
 *
 * Admin-scoped: both endpoints require the `food:admin` scope from the verified token's `public_metadata`
 * (`403` otherwise, FR-051). These are OPERATIONAL signals — nothing here is per-user data.
 */
import { z } from 'zod';

/** `fetch_queue` depth signals by operational status. */
export const queueDepthMetricsSchema = z.object({
    /** Rows awaiting a drain. */
    pending: z.number(),
    /** Rows currently leased to the worker. */
    inFlight: z.number(),
    /** Terminal (DLQ-equivalent) rows — NOT_FOUND / FAILED foods. */
    tombstone: z.number(),
});

/** `fetch_queue` depth signals by operational status. */
export type QueueDepthMetrics = z.infer<typeof queueDepthMetricsSchema>;

/** `food` lifecycle backlog counts (DSN-9 keeps NOT_FOUND distinct from the alarmed FAILED). */
export const backlogMetricsSchema = z.object({
    /** Foods awaiting a human disambiguation pick (FR-RES-1). */
    unresolved: z.number(),
    /** Foods no wired source has (a normal, non-alarmed outcome, DSN-9). */
    notFound: z.number(),
    /** Foods whose every source errored past the retry budget (the alarmed signal, FR-016). */
    failed: z.number(),
});

/** `food` lifecycle backlog counts. */
export type BacklogMetrics = z.infer<typeof backlogMetricsSchema>;

/** A wired source's trailing-60-min window utilization signal. */
export const sourceWindowMetricsSchema = z.object({
    /** Source id (e.g. `usda`). */
    source: z.string(),
    /** Calls recorded in the trailing 60 minutes (FR-019/FR-020). */
    windowCount: z.number(),
    /** The source's hard cap (the absolute ceiling). */
    hardCap: z.number(),
    /** The 90% pause threshold the worker self-throttles at. */
    pauseThreshold: z.number(),
    /** `windowCount / hardCap`, clamped to `[0, 1]`. */
    utilization: z.number(),
    /** Whether the worker is currently paused on this source (count ≥ threshold or 429 failsafe). */
    paused: z.boolean(),
});

/** A wired source's trailing-60-min window utilization signal. */
export type SourceWindowMetrics = z.infer<typeof sourceWindowMetricsSchema>;

/** Body for `GET /api/v1/foods/admin/metrics` — the aggregate operational payload for the dashboard. */
export const operationalMetricsSchema = z.object({
    /** `fetch_queue` depths by operational status. */
    queue: queueDepthMetricsSchema,
    /** Food lifecycle backlog counts. */
    backlog: backlogMetricsSchema,
    /** Per-wired-source rolling-window utilization. */
    sources: z.array(sourceWindowMetricsSchema),
});

/** Body for `GET /api/v1/foods/admin/metrics`. */
export type OperationalMetrics = z.infer<typeof operationalMetricsSchema>;
