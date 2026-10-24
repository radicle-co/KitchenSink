/**
 * The Nest DTO CLASS for `PATCH /api/v1/users/me/settings`, derived from the AUTHORED zod in `../settings.schema.ts` via
 * `nestjs-zod`'s `createZodDto`, exactly as `users/dto/user.dto.ts` does — the class is the framework's handle on
 * the schema, not a second description of it.
 */
import { createZodDto } from 'nestjs-zod';

import { patchUserSettingsRequestSchema } from '../settings.schema.js';

/** Request body for `PATCH /api/v1/users/me/settings`. Strict: an unknown field is a `400`. */
export class PatchUserSettingsBodyDto extends createZodDto(patchUserSettingsRequestSchema) {}
