/**
 * Query DTO for `POST /api/v1/users/me/avatar/presign`.
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../avatar.schema.ts` (CODING_STANDARDS §15.2), and
 * the same pattern as `admin/dto/adminListUsers.query.dto.ts`.
 *
 * ⚠️ THE BINDING IS THE POINT OF THIS FILE. `avatarPresignQuerySchema` already existed and validated nothing:
 * the controller took `@Query('type')` and `@Query('size')` as bare strings, whose metatype is `String`, and the
 * global pipe (`strictSchemaDeclaration: false`) passes those through. Annotating the whole query object with a
 * Zod DTO is what puts the pipe in the path — which is what stops `?size=abc` reaching the AWS SDK as `NaN`.
 */
import { createZodDto } from 'nestjs-zod';

import { avatarPresignQuerySchema } from '../avatar.schema.js';

/** Query parameters of `POST /api/v1/users/me/avatar/presign`. */
export class AvatarPresignQueryDto extends createZodDto(avatarPresignQuerySchema) {}
