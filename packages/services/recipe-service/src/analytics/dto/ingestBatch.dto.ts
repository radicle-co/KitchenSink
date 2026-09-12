/**
 * Analytics plan U4 — the ingest door's ENVELOPE DTO (G2/G5: every `@Body` is a `ZodValidationPipe`d
 * zod DTO, never `unknown`).
 *
 * ⛔ ENVELOPE-ONLY on purpose. The pipe validates that the request IS a batch (an `events` array,
 * 1..cap); each EVENT inside is validated individually in the controller against the shared
 * `queryOutcomeEventSchema` with DROP-AND-LOG semantics (AE3/R12) — a full-payload DTO here would 400
 * the whole batch on one malformed or forbidden event, voiding the valid events beside it, which is
 * exactly the behavior the per-event rule forbids.
 *
 * ⛔ And NOT a `*.schema.ts` file (KTD3): contract discovery is blunt — every `.schema.ts` under the
 * service's src is wire contract — and this route is off the domain contract by design. The batch cap
 * is imported from the shared payload module so the two doors keep ONE arithmetic.
 */
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { MAX_EVENTS_PER_BATCH } from '@kitchensink/recipe-core/analytics/event-payload';

/** The envelope: a non-empty, cap-bounded array of candidate events (validated per event later). */
export const ingestBatchEnvelopeSchema = z.strictObject({
    events: z.array(z.unknown()).min(1).max(MAX_EVENTS_PER_BATCH),
});

export class IngestBatchDto extends createZodDto(ingestBatchEnvelopeSchema) {}
