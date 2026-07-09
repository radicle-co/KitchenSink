/**
 * T036 — request DTO for `POST /v1/recipes/{recipeId}/photos/upload-url`.
 *
 * Carries only the client's intended `contentType`. The allowlist decision (jpeg/png/webp) is made in
 * {@link PhotosService.createUploadUrl} so it is unit-testable and yields a `415` domain response, so
 * this DTO validates shape only (a non-empty string).
 */
import { IsString, MaxLength, MinLength } from 'class-validator';

/** Body of `POST /v1/recipes/{recipeId}/photos/upload-url`. */
export class CreatePhotoUploadDto {
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    contentType!: string;
}
