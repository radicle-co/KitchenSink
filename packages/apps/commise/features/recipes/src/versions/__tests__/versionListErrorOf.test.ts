import { commonMessages } from '@commise/features-core/common';
import { NotFoundError } from '@kitchensink/recipe-service-client';
import { describe, expect, it, vi } from 'vitest';

import { recipeVersionMessages } from '../messages.js';
import { versionListErrorOf } from '../versionListErrorOf.js';

const { versionList } = recipeVersionMessages.en;
const { recipeUnavailable } = commonMessages.en;

/** hiddenViews R10: the one place that says a 404 on the history is final, so neither app decides it. */
describe('versionListErrorOf', () => {
    it('says the shared sentence and offers no retry for a 404', () => {
        expect(versionListErrorOf(new NotFoundError('gone'), { versionList, recipeUnavailable }, vi.fn())).toEqual({
            title: recipeUnavailable,
        });
    });

    it.each([new Error('boom'), 'timeout', undefined])('says the load error and retries for %s', (error) => {
        const onRetry = vi.fn();
        const props = versionListErrorOf(error, { versionList, recipeUnavailable }, onRetry);

        expect(props).toEqual({ title: versionList.loadError, retryLabel: versionList.retry, onRetry });
    });
});
