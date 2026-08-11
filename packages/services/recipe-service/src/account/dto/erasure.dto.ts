/**
 * Request DTO + response type for `POST /api/v1/account/erasure` (T134 / CR-002 / U3b).
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../account.schema.ts` (CODING_STANDARDS §15.2),
 * so the shape the validation pipe enforces and the shape `@kitchensink/schema-recipe` publishes are ONE
 * object. It replaced a `class-validator` class whose constraints were a second, unpublished description of
 * the same body.
 *
 * ⚠️ THE SPLIT OF RESPONSIBILITY ON `confirmationPhrase` IS UNCHANGED AND MUST STAY THAT WAY: this DTO
 * validates its SHAPE (a non-empty, length-capped string), while its VALUE is the domain gate enforced by
 * {@link import('../erasure.service.js').ErasureService} — which is also the only layer that runs for a
 * request sent with NO BODY at all. `../account.schema.ts` records the three ways narrowing the schema to a
 * literal would be a regression.
 *
 * The constants are RE-EXPORTED here rather than re-declared, so the ~10 existing importers of
 * `ACCOUNT_ERASURE_CONFIRMATION_PHRASE` from this path keep working while there is exactly one definition
 * behind it — and the UI now imports the same one from the published package.
 */
import { createZodDto } from 'nestjs-zod';

import { erasureRequestSchema } from '../account.schema.js';

/** Body of `POST /api/v1/account/erasure`. */
export class ErasureRequestDto extends createZodDto(erasureRequestSchema) {}

export {
    ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
    ACCOUNT_ERASURE_PUBLISH_WARNING,
    MAX_CONFIRMATION_PHRASE_LENGTH,
    MAX_PUBLISH_ELECTION_SIZE,
    matchesAccountErasureConfirmation,
} from '../account.schema.js';
export type { ErasureRequestAcceptedResponse } from '../account.schema.js';
