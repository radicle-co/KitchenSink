// @vitest-environment node
/**
 * Repo-wide guard (ADR-0064): a service stack learns the media CDN from SSM at DEPLOY time, never from a string.
 *
 * Three stacks consume the media CDN the global app publishes under `/kitchensink/{baseStage}/media/`: identity (avatars),
 * recipe-service (photo URLs) and recipe-workers (erasure invalidation). The defect this closes is a stack that carries its
 * own idea of the host: recipe-service shipped `https://recipe-cdn.${domainName}` - a name that never existed - behind a
 * green synth, so every stored photo URL pointed nowhere.
 *
 * | Invariant                                                                          | Test                                          |
 * | ---------------------------------------------------------------------------------- | --------------------------------------------- |
 * | each consumer reads the parameter(s) it needs from the media SSM tree              | 'reads the media tree from SSM'               |
 * | no consumer builds a CDN host from a template string or a CloudFront domain        | 'never spells a CDN host'                     |
 * | nobody imports a media export (it would lock the distribution against replacement) | 'imports no media export'                     |
 * | the retired env var survives nowhere that a workflow or an app could set it        | 'RECIPE_CLOUDFRONT_* is gone'                 |
 * | the detector sees a violation (negative control)                                   | 'the detector flags ...'                      |
 *
 * Source text is read through `withoutTsComments`, so prose that mentions the old spelling cannot trip or satisfy it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { withoutTsComments } from './roleSplitSources.js';
import { repoRoot, trackedFiles } from './serviceSources.js';

interface Consumer {
    readonly file: string;
    /** The SSM leaves under `/media/` this stack must read. */
    readonly leaves: readonly string[];
}

const CONSUMERS: readonly Consumer[] = [
    {
        file: 'packages/services/identity/infra/lib/IdentityServiceStack.ts',
        leaves: ['cdn-url', 'distribution-id', 'distribution-arn'],
    },
    {
        file: 'packages/services/recipe-service/infra/lib/RecipeServiceStack.ts',
        leaves: ['cdn-url', 'distribution-id'],
    },
    { file: 'packages/services/recipe-workers/infra/lib/RecipeWorkersStack.ts', leaves: ['distribution-id'] },
];

const read = (file: string): string => withoutTsComments(readFileSync(path.join(repoRoot, file), 'utf8'));

/** A CDN host spelled in code: a CloudFront domain, or a `recipe-cdn` / `media.` host built from a template. */
const SPELLED_HOST = /cloudfront\.net|recipe-cdn|https:\/\/media[.-]|`https?:\/\/[^`]*(?:cdn|media)[^`]*`/iu;

/** An import of a media CDN export from the data stack. */
const MEDIA_EXPORT_IMPORT = /importValue\([^)]*:(?:Media(?:Cdn|Distribution)\w*|Cdn\w*|Distribution\w*)\b/u;

describe('every media CDN consumer reads the SSM tree the global app publishes', () => {
    it.each(CONSUMERS)('$file reads the media tree from SSM', ({ file, leaves }) => {
        const source = read(file);

        expect(source).toContain('valueForStringParameter');

        expect(source).toContain('/media');

        for (const leaf of leaves) {
            expect(source, `${file} must read ${leaf} from the media tree`).toContain(`/${leaf}`);
        }
    });

    it.each(CONSUMERS)('$file never spells a CDN host', ({ file }) => {
        expect(read(file)).not.toMatch(SPELLED_HOST);
    });

    it.each(CONSUMERS)('$file imports no media export', ({ file }) => {
        expect(read(file)).not.toMatch(MEDIA_EXPORT_IMPORT);
    });

    it('the global app publishes no CloudFormation export for the distribution', () => {
        const source = read('packages/infra/global/lib/platform/mediaDelivery.ts');

        expect(source).not.toContain('exportName');
        expect(source).not.toContain('CfnOutput');
    });
});

describe('RECIPE_CLOUDFRONT_* is gone', () => {
    it('no tracked workflow, app or stack still names the retired variables', () => {
        const offenders = [
            ...trackedFiles('.github'),
            ...trackedFiles('packages/services'),
            ...trackedFiles('packages/tools'),
        ]
            .filter((file) => /\.(ts|tsx|mjs|js|yml|yaml|sh|json)$/u.test(file))
            .filter((file) => !file.includes('/node_modules/') && !file.includes('__tests__/mediaCdnFromSsm'))
            .filter((file) =>
                /RECIPE_CLOUDFRONT_(?:URL|DISTRIBUTION_ID)/u.test(readFileSync(path.join(repoRoot, file), 'utf8')),
            );

        expect(offenders).toEqual([]);
    });
});

describe('the detector (negative controls, over shapes the tree has never held)', () => {
    it.each([
        ['a placeholder host from a template', 'cloudfrontUrl: `https://recipe-cdn.${domainName}`'],
        ['a CloudFront domain', "const url = 'https://d111111abcdef8.cloudfront.net'"],
        ['a literal media host', "const url = 'https://media.commise.app'"],
        ['a sandbox media host', "const url = 'https://media-sandbox.commise.app'"],
    ])('flags %s', (_name, line) => {
        expect(withoutTsComments(line)).toMatch(SPELLED_HOST);
    });

    it.each([
        ['an SSM read', 'ssm.StringParameter.valueForStringParameter(this, `${tree}/cdn-url`)'],
        ['a prose mention in a comment', '// the old https://recipe-cdn.example host'],
    ])('does not flag %s', (_name, line) => {
        expect(withoutTsComments(line)).not.toMatch(SPELLED_HOST);
    });

    it('flags an import of a media export', () => {
        expect('Fn.importValue(`kitchensink-data-${stage}:MediaCdnUrl`)').toMatch(MEDIA_EXPORT_IMPORT);
        expect('Fn.importValue(`kitchensink-data-${stage}:MediaBucketName`)').not.toMatch(MEDIA_EXPORT_IMPORT);
    });
});
