/**
 * The `details` of a `PRIVATE_FOODS_ON_PUBLIC_RECIPE` refusal (ADR-0029 section 4): every line of a published, public
 * recipe that is bound to a food its author keeps private. Shared with every client so a refusal marks the right lines
 * and offers "Open food" without parsing text.
 *
 * Pure and platform-agnostic.
 */
import { z } from 'zod';

/** One refused line. A client matches by `foodId` and breaks ties by `sortOrder` (a line's position). */
export const privateFoodLineSchema = z.object({
    sortOrder: z.number().int().min(0),
    foodId: z.string().min(1),
});

/** The `details` of the refusal: every refused line, at least one. */
export const privateFoodLinesDetailsSchema = z.object({
    lines: z.array(privateFoodLineSchema).min(1),
});

/** One refused line. */
export type PrivateFoodLine = z.infer<typeof privateFoodLineSchema>;

/** The `details` of a `PRIVATE_FOODS_ON_PUBLIC_RECIPE` refusal. */
export type PrivateFoodLinesDetails = z.infer<typeof privateFoodLinesDetailsSchema>;
