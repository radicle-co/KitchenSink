/**
 * T029 — request DTO for `POST /v1/ingredients` and `POST /v1/ingredients/by-name`, mirroring the
 * `CreateIngredientRequest` schema in `contracts/api.openapi.yaml`.
 *
 * Both routes take the SAME body — a single display `name` — so they share one DTO (one piece of
 * knowledge, one place to change). The name is trimmed by `@Transform` BEFORE validation, so a
 * whitespace-only name fails `@IsNotEmpty` (→ 400) and the length bound is measured on the trimmed value,
 * exactly as the previous hand-rolled `requireName` did — but now under the same controller-scoped
 * `ValidationPipe` (`transform + whitelist`) every sibling controller uses, so a stray body field is
 * stripped rather than trusted. The trimmed value on the instance is what reaches the service.
 */
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Max length of a freeform/food display name (mirrors the OpenAPI `CreateIngredientRequest.name`). */
export const MAX_INGREDIENT_NAME_LENGTH = 120;

/** Body of `POST /v1/ingredients` and `POST /v1/ingredients/by-name`. */
export class CreateIngredientDto {
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsString()
    @IsNotEmpty()
    @MaxLength(MAX_INGREDIENT_NAME_LENGTH)
    name!: string;
}
