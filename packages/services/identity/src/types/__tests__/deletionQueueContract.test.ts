/**
 * The deletion queue's PRODUCER side: the message this service serialises satisfies the schema the consumer parses.
 *
 * MOVED from `@kitchensink/identity-core`'s `deletionQueueMessage.test.ts` (ADR-0091). The core package cannot
 * declare this service without a dependency cycle, since this service depends on it, and an undeclared import is an
 * edge the changed-only selector cannot see. Here both ends are declared, so a change to either selects this test.
 *
 * The assertion is a TYPE: `tsc` (this package's `typecheck`) fails if `DeletionQueueMessage` stops satisfying the
 * schema's INPUT. Widening the schema's `userId` to required on a variant the service sends without it fails it.
 */
import { idpDeletionMessageSchema } from '@kitchensink/identity-core';
import { describe, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import type { DeletionQueueMessage } from '../deletion.js';

describe('DeletionQueueMessage — the shape the service serialises', () => {
    it('satisfies the deletion queue schema the consumer parses', () => {
        expectTypeOf<DeletionQueueMessage>().toExtend<z.input<typeof idpDeletionMessageSchema>>();
    });
});
