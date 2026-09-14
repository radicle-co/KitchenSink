/**
 * The Nest DTO CLASSES for `/api/v1/admin/users`, derived from the AUTHORED zod in `../admin.schema.ts` via
 * `nestjs-zod`'s `createZodDto` (`docs/CODING_STANDARDS.md` §15.2).
 *
 * These are RESPONSE types only — every admin route takes its target from `@Param('userId')` as a bare string and
 * has no request body — so none of them is used as a validation metatype. They exist as classes purely because
 * `admin.controller.ts` annotates its return types with them, and keeping them derived from the published zod is
 * what stops the annotations drifting from what the service actually sends.
 *
 * TWO CLASSES WERE DELETED RATHER THAN TRANSLATED:
 *  - `AdminUserIdParamDto` (`@IsString() userId`) had no callers. The controller reads `@Param('userId')` directly,
 *    so the "validated param DTO" validated nothing — a decorator that looked like a boundary check and was not.
 *  - `AdminAuditLogDto` had no callers either: no route returns it. The audit trail is written to the database, not
 *    served. Publishing a shape no endpoint emits would be a contract that lies about the API's surface.
 */
import { createZodDto } from 'nestjs-zod';

import {
    adminReactivateUserResponseSchema,
    adminSuspendUserResponseSchema,
    adminUnsuspendUserResponseSchema,
    impersonationStartResponseSchema,
    impersonationStopResponseSchema,
} from '../admin.schema.js';

/** Response body for `POST /api/v1/admin/users/{userId}/suspend`. */
export class AdminSuspendUserResponseDto extends createZodDto(adminSuspendUserResponseSchema) {}

/** Response body for `POST /api/v1/admin/users/{userId}/unsuspend`. */
export class AdminUnsuspendUserResponseDto extends createZodDto(adminUnsuspendUserResponseSchema) {}

/** Response body for `POST /api/v1/admin/users/{userId}/reactivate`. */
export class AdminReactivateUserResponseDto extends createZodDto(adminReactivateUserResponseSchema) {}

/** Response body for `POST /api/v1/admin/users/{userId}/impersonation/start`. */
export class ImpersonationStartResponseDto extends createZodDto(impersonationStartResponseSchema) {}

/** Response body for `POST /api/v1/admin/users/{userId}/impersonation/stop`. */
export class ImpersonationStopResponseDto extends createZodDto(impersonationStopResponseSchema) {}
