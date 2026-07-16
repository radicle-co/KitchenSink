/**
 * CR-001 / FR-013 — request DTO for `PUT /v1/recipes/{id}/rating` (`SetRecipeRatingRequest` in
 * `contracts/api.openapi.yaml`).
 *
 * Carries ONLY `stars` (whole 1–5). There is deliberately no rater field: the rater is the verified
 * caller from the bearer token, and the controller's `ValidationPipe` runs with `whitelist: true`, so a
 * body carrying a spoofed `userId` is stripped to `{ stars }` before it reaches the service — a
 * client-suppliable rater id must never be able to rate as another user. The `1–5` bound is enforced
 * here AND by the `recipe_ratings_stars_range` DB CHECK.
 */
import { IsInt, Max, Min } from 'class-validator';

/** Body of `PUT /v1/recipes/{id}/rating`. */
export class SetRatingDto {
    @IsInt()
    @Min(1)
    @Max(5)
    stars!: number;
}
