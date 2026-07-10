/**
 * T036 — request DTO for `POST /v1/recipes/{recipeId}/photos/upload-url`.
 *
 * Carries the file the client intends to upload: its `contentType`, `fileName`, and `fileSize`. The
 * allowlist decision (jpeg/png/webp) and the 5 MB size pre-check are made in
 * {@link PhotosService.createUploadUrl} so they are unit-testable and yield `415`/`413` responses. This
 * DTO validates shape only — the single 5 MB ceiling lives on the service (`MAX_UPLOAD_BYTES`), enforced
 * identically at upload-url pre-check and at confirm (both `413`), so it is not re-encoded here.
 */
import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

/** Body of `POST /v1/recipes/{recipeId}/photos/upload-url`. */
export class CreatePhotoUploadDto {
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    contentType!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(255)
    fileName!: string;

    @IsInt()
    @Min(1)
    fileSize!: number;
}
