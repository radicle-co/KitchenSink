import { describe, it, expect, vi } from 'vitest';

import { createAuthTracer } from '../debug-trace.js';

describe('createAuthTracer', () => {
    it('is a zero-cost no-op when disabled (sink never called)', () => {
        const sink = vi.fn();
        const traceAuth = createAuthTracer(false, sink);

        traceAuth('token.verified', { sub: 'user_x' });

        expect(sink).not.toHaveBeenCalled();
    });

    it('routes enabled calls through the sink with scrubbed attributes', () => {
        const sink = vi.fn();
        const traceAuth = createAuthTracer(true, sink);

        traceAuth('provision.created', { sub: 'user_x', email: 'a@b.com', outcome: 'created' });

        expect(sink).toHaveBeenCalledTimes(1);
        const [step, attrs] = sink.mock.calls[0]!;
        expect(step).toBe('provision.created');
        // sub is preserved (correlation key); email is scrubbed.
        expect(attrs).toEqual({ sub: 'user_x', email: '[redacted]', outcome: 'created' });
    });

    it('defaults attributes to an empty object', () => {
        const sink = vi.fn();
        const traceAuth = createAuthTracer(true, sink);

        traceAuth('request.received');

        expect(sink).toHaveBeenCalledWith('request.received', {});
    });
});
