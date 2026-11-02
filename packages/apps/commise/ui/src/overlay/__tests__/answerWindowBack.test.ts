/**
 * answerWindowBack — Back inside a window: the window's interceptors first, then the host's one dismiss request.
 */
import { describe, expect, it, vi } from 'vitest';

import { createBackInterceptRegistry } from '../../backIntercept/backInterceptRegistry.js';
import { answerWindowBack, DISMISS_ROUTES } from '../dismissRoute.js';

describe('answerWindowBack', () => {
    it('requests a dismissal by the back route, once, when no interceptor is registered', () => {
        const request = vi.fn();

        answerWindowBack(createBackInterceptRegistry(), request);

        expect(request).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith('back');
    });

    it('does not request a dismissal when an interceptor consumes the press', () => {
        const registry = createBackInterceptRegistry();
        const request = vi.fn();
        registry.register(() => true);

        answerWindowBack(registry, request);

        expect(request).not.toHaveBeenCalled();
    });

    it('requests a dismissal when every interceptor declines', () => {
        const registry = createBackInterceptRegistry();
        const request = vi.fn();
        registry.register(() => false);

        answerWindowBack(registry, request);

        expect(request).toHaveBeenCalledWith('back');
    });

    it('asks the newest interceptor first and stops at the first that consumes', () => {
        const registry = createBackInterceptRegistry();
        const calls: string[] = [];
        registry.register(() => {
            calls.push('older');

            return true;
        });
        registry.register(() => {
            calls.push('newer');

            return true;
        });

        answerWindowBack(registry, vi.fn());

        expect(calls).toEqual(['newer']);
    });

    it('walks a snapshot, so an interceptor that unregisters itself does not skip the next one', () => {
        const registry = createBackInterceptRegistry();
        const calls: string[] = [];
        registry.register(() => {
            calls.push('older');

            return false;
        });
        const unregister = registry.register(() => {
            calls.push('newer');
            unregister();

            return false;
        });
        const request = vi.fn();

        answerWindowBack(registry, request);

        expect(calls).toEqual(['newer', 'older']);
        expect(request).toHaveBeenCalledTimes(1);
    });
});

describe('DISMISS_ROUTES', () => {
    it('names the six routes: the five a person raises, and the one the sheet engine raises', () => {
        expect([...DISMISS_ROUTES]).toEqual(['back', 'scrim', 'swipe', 'close', 'escape', 'sheet']);
    });
});
