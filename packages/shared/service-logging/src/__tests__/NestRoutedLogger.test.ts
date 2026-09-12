/**
 * The framework adapter — and the reason 19 `new Logger(…)` call sites are NOT edited by this change.
 *
 * ⛔ THE MEASUREMENT THIS IS BUILT ON. `NestFactory.create(mod, { logger })` calls
 * `Logger.overrideLogger(logger)`, and every `Logger` instance method resolves the static at CALL time —
 * so an instance constructed at module load, BEFORE the app is created, still routes through this adapter.
 * Driving a real `Logger` against a recording adapter shows exactly what arrives:
 *
 *     l.warn('food nutrition degraded', { reason: 'deadline', recovered: 3 })
 *         → warn('food nutrition degraded', { reason: 'deadline', recovered: 3 }, 'MyService')
 *     l.error('photos failed', 'STACK-TRACE-STRING')  → error('photos failed', 'STACK-TRACE-STRING', 'MyService')
 *     l.log('plain')                                   → log('plain', 'MyService')
 *
 * Nest appends the CONTEXT last and passes everything between the message and it through UNTOUCHED. So the
 * claim that "Nest's varargs cannot carry structured attributes" is false for a custom `LoggerService`: an
 * adapter that parses this shape gives all 19 existing sites correct structured attributes with no edit.
 * That is why this file parses varargs rather than accepting `(message, context?)` — the narrow signature
 * would have silently filed every attributes object as the context string.
 *
 * ⛔ AND IT MUST NEVER CALL NEST'S `Logger`. After `overrideLogger`, that static points back here, so a
 * fallback through it is unbounded recursion. The last case pins that.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { emitLogRecord } = vi.hoisted(() => ({ emitLogRecord: vi.fn() }));

vi.mock('../logSink.js', () => ({ emitLogRecord }));

const { NestRoutedLogger } = await import('../NestRoutedLogger.js');

describe('NestRoutedLogger', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('⛔ keeps an attributes object as ATTRIBUTES, not as the context string', () => {
        new NestRoutedLogger().warn('food nutrition degraded', { reason: 'deadline', recovered: 3 }, 'Gateway');

        expect(emitLogRecord).toHaveBeenCalledWith('warn', 'food nutrition degraded', {
            reason: 'deadline',
            recovered: 3,
            context: 'Gateway',
        });
    });

    it("reads Nest's trailing argument as the context", () => {
        new NestRoutedLogger().log('CORS origin mode: allowlist', 'bootstrap');

        expect(emitLogRecord).toHaveBeenCalledWith('info', 'CORS origin mode: allowlist', {
            context: 'bootstrap',
        });
    });

    it('⛔ keeps the STACK Nest passes to error as its own attribute', () => {
        // `apiException.filter.ts` calls `logger.error(line, renderThrowable(exception))`, so this string is
        // the rendered cause chain — the single most valuable attribute on the line.
        new NestRoutedLogger().error('GET /recipes -> 500', 'Error: Failed query\n  [cause]: 57P01', 'Filter');

        expect(emitLogRecord).toHaveBeenCalledWith('error', 'GET /recipes -> 500', {
            stack: 'Error: Failed query\n  [cause]: 57P01',
            context: 'Filter',
        });
    });

    it('falls back to a named context rather than attributing a line to nothing', () => {
        new NestRoutedLogger().log('Nest application successfully started');

        expect(emitLogRecord).toHaveBeenCalledWith('info', 'Nest application successfully started', {
            context: 'nest',
        });
    });

    it('maps all five framework methods onto the four levels the rule knows', () => {
        const logger = new NestRoutedLogger();

        logger.log('a');
        logger.warn('b');
        logger.error('c');
        logger.debug('d');
        logger.verbose('e');

        expect(emitLogRecord.mock.calls.map(([level]) => level)).toEqual(['info', 'warn', 'error', 'debug', 'debug']);
    });

    it('⚠️ stringifies a non-string message — Nest logs objects, and `[object Object]` groups them as one', () => {
        new NestRoutedLogger().log({ route: '/health', status: 200 }, 'RouterExplorer');

        expect(emitLogRecord).toHaveBeenCalledWith('info', '{"route":"/health","status":200}', {
            context: 'RouterExplorer',
        });
    });

    it('⛔ never calls back into Nest’s own Logger — after overrideLogger that static points here', async () => {
        const { Logger } = await import('@nestjs/common');
        const spy = vi.spyOn(Logger, 'overrideLogger');
        const logger = new NestRoutedLogger();

        logger.log('a');
        logger.error('b');
        logger.warn('c');

        expect(spy).not.toHaveBeenCalled();
        expect(emitLogRecord).toHaveBeenCalledTimes(3);
    });
});
