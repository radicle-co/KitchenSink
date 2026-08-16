/**
 * The Nest DTO CLASSES for `/api/v1/users/me`, derived from the AUTHORED zod in `../users.schema.ts` via
 * `nestjs-zod`'s `createZodDto` (`docs/CODING_STANDARDS.md` §15.2.1).
 *
 * WHY A CLASS AT ALL, when the schema is the authority: Nest resolves a handler parameter's validator from its
 * `design:paramtypes` METATYPE, which is a runtime class reference. `createZodDto` produces exactly that — a
 * class carrying `.schema`, which the globally-bound `ZodValidationPipe` reads. The class is the framework's
 * handle on the schema, not a second description of it; change the zod and this changes with it, unavoidably.
 *
 * ⚠️ THE PIPE MUST BE `nestjs-zod`'s. Nest's own `ValidationPipe` reads `class-validator` metadata, of which a
 * `createZodDto` class has none — bound to it, this DTO would validate NOTHING while looking validated, on a
 * route that writes user data. `app.module.ts` binds `ZodValidationPipe` under `APP_PIPE` for exactly this
 * reason, and `tests/appValidation.test.ts` pins the binding.
 */
import { createZodDto } from 'nestjs-zod';

import { deleteUserMeResponseSchema, eraseUserMeResponseSchema, patchUserMeRequestSchema } from '../users.schema.js';

/** Request body for `PATCH /api/v1/users/me`. Strict: an unknown field is a `400`. */
export class PatchUserMeBodyDto extends createZodDto(patchUserMeRequestSchema) {}

/** Response body for `DELETE /api/v1/users/me` (`202 Accepted`). */
export class DeleteUserMeResponseDto extends createZodDto(deleteUserMeResponseSchema) {}

/** Response body for `POST /api/v1/users/me/erasure` (`202 Accepted`) — the IRREVERSIBLE action. */
export class EraseUserMeResponseDto extends createZodDto(eraseUserMeResponseSchema) {}
