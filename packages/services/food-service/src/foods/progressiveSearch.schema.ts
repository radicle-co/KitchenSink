/**
 * THE PROGRESSIVE FOOD SEARCH's WIRE CONTRACT (ADR-0055 points 5 and 9, review ruling 1): `GET
 * /api/v1/foods/search/progressive?query=` answers newline-delimited JSON, one frame per line, in this order:
 *
 * 1. one `database` frame, holding the catalog group and the caller's own authored group, each with its own outcome;
 * 2. one `source` frame per remote source, in the order the sources answer: answered, busy, the cook's limit, or
 *    unavailable;
 * 3. one `complete` frame. A body that ends without it is incomplete.
 *
 * A client splits the body on the newline byte and parses each line with {@link progressiveSearchLineSchema}, which
 * skips a frame type it does not know and reads an outcome it does not know as unavailable, so a frame or an outcome
 * can be added without a client breaking. Authored here and copied into `@kitchensink/schema-food`
 * (`docs/CODING_STANDARDS.md` §15.2).
 *
 * IMPORT RESTRICTION (enforced by `@kitchensink/contract-gen`): this file may import only `zod` and flat sibling
 * `*.schema.js` modules.
 *
 * @module
 */
import { z } from 'zod';

import {
    authoredFoodSearchResultViewSchema,
    catalogSearchResultViewSchema,
    MAX_REMOTE_REFERENCE_LENGTH,
} from './foods.schema.js';

/** The body's media type: one JSON frame per line, UTF-8. */
export const PROGRESSIVE_SEARCH_CONTENT_TYPE = 'application/x-ndjson; charset=utf-8';

/** A database group that could not be read: it fails alone, and the other group and every source still answer. */
const unavailableGroupSchema = z.object({ outcome: z.literal('unavailable') });

/** The catalog group: the same results `GET /api/v1/foods/catalog/search` answers, or unavailable. */
export const catalogGroupSchema = z.discriminatedUnion('outcome', [
    z.object({ outcome: z.literal('answered'), results: z.array(catalogSearchResultViewSchema) }),
    unavailableGroupSchema,
]);

export type CatalogGroup = z.infer<typeof catalogGroupSchema>;

/** The caller's own authored foods: the same results `GET /api/v1/foods/authored/search` answers, or unavailable. */
export const authoredGroupSchema = z.discriminatedUnion('outcome', [
    z.object({ outcome: z.literal('answered'), results: z.array(authoredFoodSearchResultViewSchema) }),
    unavailableGroupSchema,
]);

export type AuthoredGroup = z.infer<typeof authoredGroupSchema>;

/** The first frame: our own database's two groups. */
export const databaseFrameSchema = z.object({
    type: z.literal('database'),
    catalog: catalogGroupSchema,
    authored: authoredGroupSchema,
});

export type DatabaseFrame = z.infer<typeof databaseFrameSchema>;

/**
 * One remote food the catalog does not hold (R66). It has no id and no variant (R64), and never the source's key.
 */
export const remoteFoodViewSchema = z.object({
    /** The name its root carries once picked, so a pick never renames what the cook chose. */
    name: z.string().min(1),
    /** The opaque reference food issued with it; `POST /api/v1/foods/remote/adopt` takes it back unread. */
    reference: z.string().min(1).max(MAX_REMOTE_REFERENCE_LENGTH),
});

export type RemoteFoodView = z.infer<typeof remoteFoodViewSchema>;

/**
 * A source's register id, as `GET /api/v1/foods/sources` names it (`usda`): the app reads its name from there, so no
 * name crosses the wire here.
 */
const sourceIdSchema = z.string().regex(/^[a-z]+$/u);

/** Whole seconds until a refusal lets the caller try again, at least 1. */
const retryAfterSecondsSchema = z.number().int().positive();

/** One remote source's frame. */
export const sourceFrameSchema = z.discriminatedUnion('outcome', [
    z.object({
        type: z.literal('source'),
        source: sourceIdSchema,
        /** The source answered: its foods the catalog does not hold, in its order. Empty shows nothing. */
        outcome: z.literal('answered'),
        items: z.array(remoteFoodViewSchema),
    }),
    z.object({
        type: z.literal('source'),
        source: sourceIdSchema,
        /** The source's shared window is full or blocked: try later. */
        outcome: z.literal('busy'),
        retryAfterSeconds: retryAfterSecondsSchema,
    }),
    z.object({
        type: z.literal('source'),
        source: sourceIdSchema,
        /** The cook's own hourly source budget is spent, until `retryAfterSeconds` from now. Cached answers still come. */
        outcome: z.literal('limited'),
        retryAfterSeconds: retryAfterSecondsSchema,
    }),
    z.object({
        type: z.literal('source'),
        source: sourceIdSchema,
        /** No usable answer in time: try now. */
        outcome: z.literal('unavailable'),
    }),
]);

export type SourceFrame = z.infer<typeof sourceFrameSchema>;

/** The last frame: every source has answered, or been closed. */
export const completeFrameSchema = z.object({ type: z.literal('complete') });

export type CompleteFrame = z.infer<typeof completeFrameSchema>;

/** Any frame of the progressive search. */
export const progressiveSearchFrameSchema = z.discriminatedUnion('type', [
    databaseFrameSchema,
    sourceFrameSchema,
    completeFrameSchema,
]);

export type ProgressiveSearchFrame = z.infer<typeof progressiveSearchFrameSchema>;

/**
 * One line of the body as a client reads it: a frame, or `null` for a frame type the client does not know, which it
 * skips. A group or a source frame that does not parse, an unknown outcome included, reads as unavailable; a source
 * frame naming no valid source is skipped. A line that is not an object with a `type` is not a frame, and fails.
 *
 * A reader's schema, not a wire shape: the server writes {@link progressiveSearchFrameSchema}, which the published
 * document describes.
 */
export const progressiveSearchLineSchema = z.union([
    databaseFrameSchema.extend({
        catalog: catalogGroupSchema.catch({ outcome: 'unavailable' }),
        authored: authoredGroupSchema.catch({ outcome: 'unavailable' }),
    }),
    sourceFrameSchema,
    z
        .object({ type: z.literal('source'), source: sourceIdSchema })
        .transform(({ source }) => ({ type: 'source' as const, source, outcome: 'unavailable' as const })),
    completeFrameSchema,
    z.object({ type: z.string() }).transform(() => null),
]);

export type ProgressiveSearchLine = z.infer<typeof progressiveSearchLineSchema>;
