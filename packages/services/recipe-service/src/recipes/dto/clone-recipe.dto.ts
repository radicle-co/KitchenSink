/**
 * Request DTO for `POST /api/v1/recipes/{id}/clone` (FR-011 recipe clone).
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../recipes.schema.ts` (CODING_STANDARDS §15.2).
 * A clone deterministically copies the source recipe's content + attribution and derives the new recipe's
 * visibility from the C-004 clone-default rule, so the body carries NO client-supplied content: every field is
 * server-derived from the source. The schema is an empty object with `.default({})`, which is what makes a
 * BODYLESS `POST` legal — a default applies to an ABSENT body, while `strictObject`'s catchall judges the keys
 * of a body that IS present, so a stray field is a `400` rather than silently dropped.
 *
 * ⚠️ A `createZodDto` class carries NO `class-validator` metadata; see `create-recipe.dto.ts`.
 */
import { createZodDto } from 'nestjs-zod';

import { cloneRecipeRequestSchema } from '../recipes.schema.js';

/** Body of `POST /api/v1/recipes/{id}/clone` (no client-controlled fields). */
export class CloneRecipeDto extends createZodDto(cloneRecipeRequestSchema) {}
