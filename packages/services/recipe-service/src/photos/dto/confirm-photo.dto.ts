/**
 * T036 — request DTO for `POST /v1/recipes/{recipeId}/photos/confirm`.
 *
 * Echoes back the `s3Key` the client received from `upload-url` and uploaded to. The service validates
 * the object itself (magic bytes + HEAD size) and that the key is scoped to the owner + recipe.
 */
import { IsString, MaxLength, MinLength } from 'class-validator';

/** Body of `POST /v1/recipes/{recipeId}/photos/confirm`. */
export class ConfirmPhotoDto {
    @IsString()
    @MinLength(1)
    @MaxLength(1024)
    s3Key!: string;
}
