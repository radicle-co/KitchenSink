/**
 * Nest adapters over the AUTHORED food wire contract (`../foods.schema.ts`, `docs/CODING_STANDARDS.md` §15.2).
 *
 * Each class is a thin `createZodDto` wrapper, so the shape the validation pipe enforces and the shape
 * `@kitchensink/schema-food` publishes are ONE object rather than two that happen to agree. Before this file
 * existed, `FoodsController` took `@Body() body: unknown` on all three write routes and re-derived validation
 * per handler with a hand-rolled `safeParse` + `throw new BadRequestException({ error: '…' })` — the same work
 * three times, each with its own error label, and one route (`search`) with no validation at all despite a
 * published schema for it.
 *
 * ⚠️ A `createZodDto` CLASS CARRIES NO `class-validator` METADATA. It is therefore validated ONLY by
 * `nestjs-zod`'s `ZodValidationPipe`, which `AppModule` binds globally through the `APP_PIPE` token. Under
 * Nest's own `ValidationPipe` — or under `ZodValidationPipe` bound to the bare class token — every one of these
 * DTOs would validate NOTHING while looking correctly wired, which is a strictly worse failure than having no
 * pipe at all because it presents as done. `packages/infra/global/__tests__/serviceSecurityInvariants.test.ts`
 * asserts the binding for every service, including services that do not exist yet.
 */
import { createZodDto } from 'nestjs-zod';

import {
    addFoodRequestSchema,
    batchAddFoodRequestSchema,
    resolveFoodRequestSchema,
    searchFoodQuerySchema,
} from '../foods.schema.js';

/** Body of `POST /api/v1/foods` — add by name (FR-005/FR-006). */
export class AddFoodBodyDto extends createZodDto(addFoodRequestSchema) {}

/**
 * Body of `POST /api/v1/foods/batch` — batch add by name (FR-045).
 *
 * The array's SHAPE is validated here. The two rules that are not are deliberate and stay in the controller:
 * dropping blank entries is server-side normalization (a `.transform()` cannot be represented in the published
 * JSON Schema at all), and the cap is `FOOD_MAX_BATCH_NAMES`, a runtime configuration value that a static bound
 * in the contract would silently disagree with the moment it is tuned.
 */
export class BatchAddFoodBodyDto extends createZodDto(batchAddFoodRequestSchema) {}

/** Body of `PATCH /api/v1/foods/{id}` — resolve from the user's candidate pick (FR-RES-2, DSN-14). */
export class ResolveFoodBodyDto extends createZodDto(resolveFoodRequestSchema) {}

/** Query of `GET /api/v1/foods/search` (FR-008) — trimmed, required, and length-bounded. */
export class SearchFoodQueryDto extends createZodDto(searchFoodQuerySchema) {}
