/**
 * CR-001 / FR-013 — request DTO for `PUT /api/v1/recipes/{id}/rating`.
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../ratings.schema.ts` (CODING_STANDARDS §15.2),
 * which composes `recipe-core`'s `recipeRatingStarsSchema` — so the whole-star 1–5 rule has exactly ONE
 * definition, shared by this pipe, the published contract, and the client.
 *
 * Carries ONLY `stars`. There is deliberately no rater field: the rater is the verified caller from the bearer
 * token, and the schema is `z.strictObject` (GR-017 §17-c), so a body carrying a spoofed `userId` is answered
 * `400` rather than reaching the service — a client-suppliable rater id must never be able to rate as another
 * user. It was `class-validator`'s `whitelist: true` before this seam, then zod's default STRIP, and is now a
 * rejection; `ratings.dto.test.ts` and `../__tests__/ratings.schema.test.ts` assert the current behaviour. The
 * `1–5` bound is enforced here AND by the `recipe_ratings_stars_range` DB CHECK.
 */
import { createZodDto } from 'nestjs-zod';

import { setRatingRequestSchema } from '../ratings.schema.js';

/** Body of `PUT /api/v1/recipes/{id}/rating`. */
export class SetRatingDto extends createZodDto(setRatingRequestSchema) {}
