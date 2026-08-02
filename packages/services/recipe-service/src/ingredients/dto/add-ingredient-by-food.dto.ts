/**
 * Stage 2 — request DTO for `POST /api/v1/ingredients/by-food`: admit a food-catalog suggestion into the shared
 * `ingredients` catalog.
 *
 * The body carries ONLY the opaque `foodId`. There is deliberately **no `name` field**: the display name is
 * read from the food service on the server side. `ingredients` is an ownerless catalog shared by every user
 * (data-model R5), so accepting a caller-supplied name would let any authenticated client attach an arbitrary
 * label to a real food — mislabeled nutrition for everyone, with no owner to attribute it to. The controller's
 * `ValidationPipe` runs with `whitelist: true`, so a client that sends `name` anyway has it stripped before
 * the service sees the body; this DTO is the wire contract that makes that guarantee explicit.
 *
 * `foodId` is trimmed by `@Transform` BEFORE validation (matching {@link CreateIngredientDto}), so a
 * whitespace-only id fails `@IsNotEmpty` (→ 400) rather than reaching the food service.
 */
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Max length of an opaque food-service id. Generous relative to a ULID (26 chars) because the id is
 * deliberately OPAQUE to this service — the bound exists to reject junk early, not to encode food-service's
 * id format here (which would couple the two services' identity choices).
 */
export const MAX_FOOD_ID_LENGTH = 64;

/** Body of `POST /api/v1/ingredients/by-food`. */
export class AddIngredientByFoodDto {
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsString()
    @IsNotEmpty()
    @MaxLength(MAX_FOOD_ID_LENGTH)
    foodId!: string;
}
