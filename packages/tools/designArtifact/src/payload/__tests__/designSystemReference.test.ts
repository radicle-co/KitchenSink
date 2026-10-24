import { describe, expect, it } from 'vitest';

import { isDesignArtifactError } from '../../errors.js';
import { designSystemReference } from '../designSystemReference.js';

function failureOf(env: Record<string, string | undefined>): unknown {
    try {
        designSystemReference(env);
    } catch (error) {
        return error;
    }

    return undefined;
}

describe('designSystemReference', () => {
    it('takes the URL and the version from the environment', () => {
        expect(
            designSystemReference({
                DESIGN_SYSTEM_ARTIFACT_URL: 'https://claude.ai/artifact/OTHER',
                DESIGN_SYSTEM_ARTIFACT_VERSION: 'v9',
            }),
        ).toEqual({ artifact: 'https://claude.ai/artifact/OTHER', version: 'v9' });
    });

    it.each([
        ['neither variable', {}],
        [
            'both blank: an exported-but-empty CI variable is unset',
            { DESIGN_SYSTEM_ARTIFACT_URL: '', DESIGN_SYSTEM_ARTIFACT_VERSION: '' },
        ],
    ])('has no reference with %s, so the canvas links to no design system', (_label, env) => {
        expect(designSystemReference(env)).toBeUndefined();
    });

    it.each([
        ['a URL without a version', { DESIGN_SYSTEM_ARTIFACT_URL: 'https://claude.ai/artifact/X' }],
        ['a version without a URL', { DESIGN_SYSTEM_ARTIFACT_VERSION: 'v1' }],
        [
            'a URL and a blank version',
            { DESIGN_SYSTEM_ARTIFACT_URL: 'https://claude.ai/artifact/X', DESIGN_SYSTEM_ARTIFACT_VERSION: '' },
        ],
    ])(
        'refuses %s: a link to an artifact with no revision cannot say what the canvas was copied from',
        (_label, env) => {
            const failure = failureOf(env);

            expect(isDesignArtifactError(failure) && failure.code).toBe('invalid-reference');
            expect(failure).toHaveProperty('message', expect.stringContaining('DESIGN_SYSTEM_ARTIFACT_VERSION'));
            expect(failure).toHaveProperty('message', expect.stringContaining('DESIGN_SYSTEM_ARTIFACT_URL'));
        },
    );

    it.each(['not a url', 'http://claude.ai/artifact/x', 'https://evil.example/artifact/x'])(
        'refuses %j: the canvas links only to a claude.ai artifact over https',
        (url) => {
            const failure = failureOf({ DESIGN_SYSTEM_ARTIFACT_URL: url, DESIGN_SYSTEM_ARTIFACT_VERSION: 'v1' });

            expect(isDesignArtifactError(failure) && failure.code).toBe('invalid-reference');
            expect(failure).toHaveProperty('message', expect.stringContaining('DESIGN_SYSTEM_ARTIFACT_URL'));
        },
    );
});
