/**
 * Who bound an ingredient line to its food (ADR-0072 §5) — the closed set a recipe line's `boundBy` can carry on the wire.
 *
 * The values are a one-way door for stored rows (`ingredients.bound_by`, migration 0060). This is the WIRE statement of
 * the set; `recipe-service` owns the others (`BOUND_BY_VALUES` in `recipes/domain/bindingOriginCarryForward.ts`, and the
 * SQL CHECK), and `importSchemaParity.test.ts` compares all three, so adding a value in one place and not the others
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

/** Runtime validator for a line's binding origin. Response-only: a client never sends it. */
export const boundBySchema = z.enum(['exact', 'curated', 'review', 'default', 'autoBest', 'cook']);

/** One origin. */
export type BoundBy = z.infer<typeof boundBySchema>;
