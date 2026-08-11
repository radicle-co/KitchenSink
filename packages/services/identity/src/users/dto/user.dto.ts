/**
 * The Nest DTO CLASSES for `/api/v1/users/me`, derived from the AUTHORED zod in `../users.schema.ts` via
 * `nestjs-zod`'s `createZodDto` (`docs/CODING_STANDARDS.md` §15.2.1: "The service consumes its own zod for
 * request validation, so server and clients validate against one authored definition").
 *
 * WHAT THIS REPLACES. Six `class-validator` classes. Four of them —`GetUserMeResponseDto`, `AccountDto`,
 * `UserProfileResponseDto`, plus `admin.dto.ts`'s `AdminUserIdParamDto` and `AdminAuditLogDto` — had NO
 * CALLERS: they were a second, decorator-shaped description of shapes that already existed as interfaces, kept
 * alive only by being exported. They are deleted rather than translated. The two that were real
 * (`PatchUserMeBodyDto`, `DeleteUserMeResponseDto`) are now one line each over the published schema.
 *
 * WHY A CLASS AT ALL, when the schema is the authority. Nest resolves a handler parameter's validator from its
 * `design:paramtypes` METATYPE, which is a runtime class reference. `createZodDto` produces exactly that: a class
 * carrying `.schema`, which the globally-bound `ZodValidationPipe` reads. So the class is the framework's handle
 * on the schema, not a second description of it — change the zod and this changes with it, unavoidably.
 *
 * ⚠️ THE PIPE MUST BE `nestjs-zod`'s. Nest's own `ValidationPipe` reads `class-validator` metadata, of which a
 * `createZodDto` class has none — bound to it, this DTO would validate NOTHING while looking validated, on a route
 * that writes user data. `app.module.ts` binds `ZodValidationPipe` under `APP_PIPE` for exactly this reason, and
 * `tests/app-validation.test.ts` pins the binding.
 */
import { createZodDto } from 'nestjs-zod';

import { deleteUserMeResponseSchema, patchUserMeRequestSchema } from '../users.schema.js';

/**
 * Request body for `PATCH /api/v1/users/me`.
 *
 * Strict: an unknown field is a `400`, preserving the `forbidNonWhitelisted` behaviour of the pipe this replaced.
 */
export class PatchUserMeBodyDto extends createZodDto(patchUserMeRequestSchema) {}

/** Response body for `DELETE /api/v1/users/me` (`202 Accepted`). */
export class DeleteUserMeResponseDto extends createZodDto(deleteUserMeResponseSchema) {}
