import { beforeEach, describe, expect, it, vi } from 'vitest';

import { INTERRUPTION_KINDS, type InterruptionKind } from '../sessionInterruptions.js';

async function freshModule(): Promise<typeof import('../sessionInterruptions.js')> {
    vi.resetModules();

    return import('../sessionInterruptions.js');
}

describe('sessionInterruptions (plan 0011 KTD4)', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('is empty at the start of an app process', async () => {
        const { anyShown } = await freshModule();

        expect(anyShown()).toBe(false);
    });

    it.each(INTERRUPTION_KINDS)('anyShown is true after only %s is marked', async (kind: InterruptionKind) => {
        const { anyShown, markShown } = await freshModule();

        markShown(kind);

        expect(anyShown()).toBe(true);
    });

    it('lists every owner kind', () => {
        expect([...INTERRUPTION_KINDS].sort()).toEqual(
            ['offer', 'paywall', 'pushPermission', 'storeReview', 'timerAlertPermission'].sort(),
        );
    });

    it('marking twice is the same as once, and a new module instance starts empty again', async () => {
        const first = await freshModule();

        first.markShown('paywall');
        first.markShown('paywall');
        const second = await freshModule();

        expect(first.anyShown()).toBe(true);
        expect(second.anyShown()).toBe(false);
    });
});
