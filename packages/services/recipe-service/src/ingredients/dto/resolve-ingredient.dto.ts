/**
 * T029 — request DTO for `POST /v1/ingredients/{id}/resolve`, mirroring the `ResolveIngredientRequest`
 * schema in `contracts/api.openapi.yaml`.
 *
 * Carries the picked candidate ids for disambiguating an `UNRESOLVED` food-backed ingredient. This is only
 * the boundary SHAPE check (a non-empty, bounded array of non-blank strings); the service further validates
 * each id against the food's OWN candidate set. Each id is trimmed by `@Transform` before validation so a
 * blank-after-trim id fails `@IsNotEmpty` (→ 400) and the trimmed ids are what reach the service — the exact
 * semantics of the previous hand-rolled `requireCandidateIds`, now under the shared `ValidationPipe`.
 */
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsNotEmpty, IsString } from 'class-validator';

/**
 * Max candidate ids a single resolve request may carry. The food service resolves from a picked subset of
 * one food's own (small) candidate set, so a low cap keeps a malformed/abusive body bounded.
 */
export const MAX_CANDIDATE_IDS = 20;

/** Body of `POST /v1/ingredients/{id}/resolve`. */
export class ResolveIngredientDto {
    @Transform(({ value }) =>
        Array.isArray(value) ? value.map((id) => (typeof id === 'string' ? id.trim() : id)) : value,
    )
    @IsArray()
    @ArrayNotEmpty()
    @ArrayMaxSize(MAX_CANDIDATE_IDS)
    @IsString({ each: true })
    @IsNotEmpty({ each: true })
    candidateIds!: string[];
}
