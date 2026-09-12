/**
 * The facade identity's call sites already use — signature unchanged, destination fixed.
 *
 * ⚠️ The shape is PRESERVED deliberately: identity's six adopters keep `logger.warn('msg', { … })`
 * untouched, so this change is legible as a routing change rather than a rewrite. What changed underneath
 * is that a line no longer vanishes when no Sentry client exists.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { emitLogRecord } = vi.hoisted(() => ({ emitLogRecord: vi.fn() }));

vi.mock('../logSink.js', () => ({ emitLogRecord }));

const { createServiceLogger } = await import('../serviceLogger.js');

describe('createServiceLogger', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('tags every line with the context it was created for', () => {
        createServiceLogger('UsersService').log('resolved');

        expect(emitLogRecord).toHaveBeenCalledWith('info', 'resolved', { context: 'UsersService' });
    });

    it('maps log/warn/error onto the three levels the rule knows', () => {
        const logger = createServiceLogger('SqsService');

        logger.log('a');
        logger.warn('b');
        logger.error('c');

        expect(emitLogRecord.mock.calls.map(([level]) => level)).toEqual(['info', 'warn', 'error']);
    });

    it('merges an object extra into the attributes', () => {
        createServiceLogger('AdminService').warn('quota low', { remaining: 3 });

        expect(emitLogRecord).toHaveBeenLastCalledWith('warn', 'quota low', {
            context: 'AdminService',
            remaining: 3,
        });
    });

    it('files a bare string extra as `detail` rather than losing it or stringifying the bag', () => {
        createServiceLogger('DeletionQueue').error('enqueue failed', 'AccessDenied');

        expect(emitLogRecord).toHaveBeenLastCalledWith('error', 'enqueue failed', {
            context: 'DeletionQueue',
            detail: 'AccessDenied',
        });
    });

    it('⚠️ never lets an extra overwrite the context it is being attributed to', () => {
        createServiceLogger('AuthMiddleware').warn('token rejected', { context: 'not-this' });

        expect(emitLogRecord).toHaveBeenLastCalledWith('warn', 'token rejected', { context: 'AuthMiddleware' });
    });
});
