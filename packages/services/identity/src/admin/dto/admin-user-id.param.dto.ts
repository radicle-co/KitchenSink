/**
 * Path-parameter DTO for the five admin action routes — a thin `nestjs-zod` adapter over the AUTHORED contract in
 * `../admin.schema.ts` (CODING_STANDARDS §15.2), the same pattern as `admin-list-users.query.dto.ts`.
 *
 * ⚠️ THE BINDING IS THE POINT OF THIS FILE, and the controller MUST annotate the WHOLE params object
 * (`@Param() params: AdminUserIdParamDto`) rather than a single key (`@Param('userId') userId: string`). The
 * global `ZodValidationPipe` is constructed with `strictSchemaDeclaration: false`, which makes it PASS THROUGH
 * any argument whose metatype is not a Zod DTO — and the metatype of `@Param('userId') userId: string` is
 * `String`. That is precisely how five admin-privileged routes came to hand an unchecked caller-supplied string
 * into a database predicate while reading as validated.
 *
 * ⚠️ A `createZodDto` class carries NO `class-validator` metadata, so this validates NOTHING under Nest's own
 * `ValidationPipe`. The service binds exactly one pipe, globally, as `APP_PIPE` in `app.module.ts`;
 * `tests/app-validation.test.ts` asserts it is `nestjs-zod`'s and not Nest's, and
 * `tests/admin-param-validation.test.ts` asserts a known-bad id really is rejected on every route.
 */
import { createZodDto } from 'nestjs-zod';

import { adminUserIdParamSchema } from '../admin.schema.js';

/** The `{userId}` path parameter of `POST /api/v1/admin/users/{userId}/…`. */
export class AdminUserIdParamDto extends createZodDto(adminUserIdParamSchema) {}
