/**
 * Query DTO for `GET /api/v1/admin/users` — a thin `nestjs-zod` adapter over the AUTHORED contract in
 * `../admin.schema.ts` (CODING_STANDARDS §15.2).
 *
 * ⚠️ THE BINDING IS THE POINT OF THIS FILE. `adminListUsersQuerySchema` already existed and was already correct
 * in spirit; it was simply never reached, because the controller took five bare `@Query('…')` strings and the
 * global `ZodValidationPipe` is constructed with `strictSchemaDeclaration: false`, which makes it PASS THROUGH
 * any parameter whose metatype is not a Zod DTO. A schema nothing is bound to validates nothing — and it looks
 * validated in review. Wrapping it in a DTO and annotating the parameter with that class is what puts the pipe
 * in the path.
 *
 * ⚠️ A `createZodDto` class carries NO `class-validator` metadata, so this validates NOTHING under Nest's own
 * `ValidationPipe`. The service binds exactly one pipe, globally, as `APP_PIPE` in `app.module.ts`, and
 * `tests/app-validation.test.ts` asserts it is a `ZodValidationPipe` and NOT a `ValidationPipe`. Do not add a
 * route- or controller-scoped `ValidationPipe` here; it would silently disable this validation while leaving
 * every visible sign of it in place.
 */
import { createZodDto } from 'nestjs-zod';

import { adminListUsersQuerySchema } from '../admin.schema.js';

/** Query parameters of `GET /api/v1/admin/users`. */
export class AdminListUsersQueryDto extends createZodDto(adminListUsersQuerySchema) {}

export { MAX_ADMIN_LIST_LIMIT } from '../admin.schema.js';
