/**
 * Who bound an ingredient line to its food (ADR-0072 §5) — the closed set a recipe line's `boundBy` can carry on the wire.
 *
 * The values are a one-way door for stored rows (`ingredients.bound_by`, migration 0060). {@link BOUND_BY_VALUES} is the
 * ONE TypeScript statement of the set: the wire schema is built from it, and `recipe-service` re-exports it from
 * `recipes/domain/bindingOriginCarryForward.ts`, where the carry-forward rule reads it. The SQL CHECK is the only other
 * statement, and `importSchemaParity.test.ts` compares it with this one, so adding a value in one place and not the other
 * fails a test instead of failing at the INSERT.
 *
 * | Value      | The line was bound by                                                                    |
 * | ---------- | ---------------------------------------------------------------------------------------- |
 * | `exact`    | A confident exact-name match                                                             |
 * | `curated`  | A confident curated mapping                                                              |
 * | `review`   | A confident match the review gate verified, or a remembered match                        |
 * | `default`  | The seeded default, where defaults bind (Save lines as written, or Save and leave)       |
 * | `autoBest` | "Pick the best match for me"                                                             |
 * | `cook`     | The cook's own pick                                                                      |
 */
import { z } from 'zod';

/** Who bound a line to its food: the closed set, in the order the table above lists it. */
export const BOUND_BY_VALUES = ['exact', 'curated', 'review', 'default', 'autoBest', 'cook'] as const;

/** One origin. */
export type BoundBy = (typeof BOUND_BY_VALUES)[number];

/** Runtime validator for a line's binding origin. Response-only: a client never sends it. */
export const boundBySchema = z.enum(BOUND_BY_VALUES);

/**
 * Whether a value is one of {@link BOUND_BY_VALUES}. For narrowing a stored `text` column without a zod parse per line.
 *
 * @param value - Anything.
 * @returns `true` for a known origin. Pure.
 */
export function isBoundBy(value: unknown): value is BoundBy {
    return BOUND_BY_VALUES.some((origin) => origin === value);
}
