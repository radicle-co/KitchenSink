/**
 * CR-001 / FR-013 — request DTO for `PUT /api/v1/recipes/{id}/rating`.
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../ratings.schema.ts` (CODING_STANDARDS §15.2),
 * which is itself `recipe-core`'s `setRecipeRatingInputSchema` — so the whole-star 1–5 rule has exactly ONE
 * definition, shared by this pipe, the published contract, and the client.
 *
 * Carries ONLY `stars`. There is deliberately no rater field: the rater is the verified caller from the
 * bearer token, and `z.object` strips unknown keys, so a body carrying a spoofed `userId` is reduced to
 * `{ stars }` before it reaches the service — a client-suppliable rater id must never be able to rate as
 * another user. (`ratings.dto.test.ts` asserts that strip; it was `class-validator`'s `whitelist: true`
 * before this seam and is zod's default now.) The `1–5` bound is enforced here AND by the
 * `recipe_ratings_stars_range` DB CHECK.
 */
import { createZodDto } from 'nestjs-zod';

import { setRatingRequestSchema } from '../ratings.schema.js';

/** Body of `PUT /api/v1/recipes/{id}/rating`. */
export class SetRatingDto extends createZodDto(setRatingRequestSchema) {}
