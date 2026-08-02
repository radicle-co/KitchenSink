/**
 * T036 — request DTO for `PATCH /api/v1/recipes/{recipeId}/photos/reorder`.
 *
 * Carries the recipe's photo ids in their desired display order; the DAL rewrites each row's
 * `sortOrder` to its index in this array.
 */
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

/** Body of `PATCH /api/v1/recipes/{recipeId}/photos/reorder`. */
export class ReorderPhotosDto {
    @IsArray()
    @ArrayMinSize(1)
    @IsUUID('4', { each: true })
    photoIds!: string[];
}
