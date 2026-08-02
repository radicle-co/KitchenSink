/**
 * T036 — request DTO for `POST /api/v1/recipes/{recipeId}/photos/confirm`.
 *
 * Echoes back the object `key` the client received from `upload-url` and uploaded to. The service
 * validates the object itself (magic bytes + HEAD size) and that the key is scoped to the owner + recipe.
 * `contentType` is accepted for contract conformance but is NOT trusted: the server authoritatively
 * detects the stored content type from the object's bytes and never persists this client-declared value.
 */
import { IsString, MaxLength, MinLength } from 'class-validator';

/** Body of `POST /api/v1/recipes/{recipeId}/photos/confirm`. */
export class ConfirmPhotoDto {
    @IsString()
    @MinLength(1)
    @MaxLength(1024)
    key!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(100)
    contentType!: string;
}
