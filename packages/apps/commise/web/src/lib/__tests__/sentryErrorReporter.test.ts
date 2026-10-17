/**
 * The web's error reporter: the one adapter from the app shell's `ErrorReporter` seam to Sentry, bound for Home's widget
 * boundaries and handed to the recipe editor (a Discard storage refused).
 */
import * as Sentry from '@sentry/nextjs';
import { describe, expect, it, vi } from 'vitest';

import { reportErrorToSentry } from '../sentryErrorReporter';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

describe('reportErrorToSentry', () => {
    it('captures the error with the caller`s context as extra', () => {
        const error = new Error('quota exceeded');

        reportErrorToSentry(error, { operation: 'recipeDiscard' });

        expect(Sentry.captureException).toHaveBeenCalledWith(error, { extra: { operation: 'recipeDiscard' } });
    });

    it('captures an error with no context as it is', () => {
        const error = new Error('boom');

        reportErrorToSentry(error);

        expect(Sentry.captureException).toHaveBeenLastCalledWith(error, undefined);
    });
});
