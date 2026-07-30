/**
 * Unit tests for the appShell `errorReporter` seam (DA9): the injected {@link ErrorReporter} token a widget
 * boundary (or any observability call site) reports through instead of importing a platform Sentry SDK
 * directly. Mirrors the tolerant-resolve contract already proven by `resolveHomeWidgets`.
 */
import { describe, expect, it, vi } from 'vitest';
import { createContainer } from 'ditox';

import { errorReporterToken, resolveErrorReporter, type ErrorReporter } from '../appShell.js';

describe('errorReporterToken / resolveErrorReporter', () => {
    it('resolves a bound reporter and forwards the error + context to it', () => {
        const container = createContainer();
        const fakeReporter: ErrorReporter = vi.fn();
        container.bindValue(errorReporterToken, fakeReporter);

        const report = resolveErrorReporter(container);
        const error = new Error('boom');
        report(error, { widget: 'recipe' });

        expect(fakeReporter).toHaveBeenCalledWith(error, { widget: 'recipe' });
    });

    it('falls back to a no-op (never throws) when no platform has bound a reporter', () => {
        const container = createContainer();

        const report = resolveErrorReporter(container);

        expect(() => report(new Error('unbound'))).not.toThrow();
    });
});
