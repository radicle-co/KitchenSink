/**
 * Guard: no CDK app builds a DOCKER IMAGE ASSET (the bootstrap-qualifier ADR).
 *
 * The CI roles are given the file-publishing and deploy bootstrap roles and NOT the image-publishing role: CI
 * pushes the service images itself, to `kitchensink-*` ECR repositories that stacks only reference
 * (`ContainerImage.fromEcrRepository`). So a construct that built an image asset would fail a deploy with
 * AccessDenied on the image-publishing role. This turns that into a unit-tier failure naming the file.
 *
 * | Invariant                                                                  | Test                                           |
 * | -------------------------------------------------------------------------- | ---------------------------------------------- |
 * | The sweep reads the CDK sources (not an empty set)                          | 'sweeps the CDK sources'                        |
 * | No CDK source uses an image-asset construct                                 | 'uses no docker image asset construct'          |
 * | The predicate can fail                                                      | negative-control fixtures                       |
 *
 * WHY source and not synth: it runs without built Lambda bundles, in the unit tier, and covers every app. The
 * synthesized proof is `bootstrap/scripts/templateParity.ts` (it fails on any `dockerImages` in an `assets.json`)
 * and `cdkQualifierBoundary.test.ts`; this guard names the cause instead of the symptom.
 *
 * WHY the AST: an identifier in a comment (this file's own docs, a "do not use DockerImageAsset" note) is not a use.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { parse, repoRoot, trackedFiles, visit } from './serviceSources.js';

/** Constructs and factories that build an image asset (the container is built and pushed at deploy time). */
const IMAGE_ASSET_IDENTIFIERS = new Set(['DockerImageAsset', 'DockerImageFunction', 'TarballImageAsset', 'AssetImage']);

/** `Class.member` factories that build an image asset. */
const IMAGE_ASSET_FACTORIES = new Map<string, ReadonlySet<string>>([
    ['ContainerImage', new Set(['fromAsset', 'fromDockerImageAsset', 'fromTarball'])],
    ['Code', new Set(['fromAssetImage', 'fromDockerBuild'])],
]);

/** The last name of `ContainerImage` or `ecs.ContainerImage`: the namespace the import chose is not the construct. */
function tailName(expression: ts.Expression): string {
    if (ts.isIdentifier(expression)) {
        return expression.text;
    }

    return ts.isPropertyAccessExpression(expression) ? expression.name.text : '';
}

/**
 * Every image-asset use in a source file.
 *
 * @param file - Path, for the parser only.
 * @param contents - The file's text.
 * @returns One message per use. Pure.
 */
function imageAssetUses(file: string, contents: string): readonly string[] {
    const uses: string[] = [];

    visit(parse({ file, contents }), (node) => {
        if (ts.isIdentifier(node) && IMAGE_ASSET_IDENTIFIERS.has(node.text)) {
            uses.push(node.text);
        }

        if (
            ts.isPropertyAccessExpression(node) &&
            IMAGE_ASSET_FACTORIES.get(tailName(node.expression))?.has(node.name.text) === true
        ) {
            uses.push(`${tailName(node.expression)}.${node.name.text}`);
        }
    });

    return uses;
}

/** The CDK sources: every non-test TypeScript file of an `infra/` directory and of the global app's `lib`/`bin`. */
function cdkSources(): readonly string[] {
    return trackedFiles('packages').filter(
        (file) =>
            file.endsWith('.ts') &&
            !file.includes('node_modules/') &&
            !/(?:^|\/)(?:__tests__|tests)\//u.test(file) &&
            (/\/infra\/(?:lib|bin)\//u.test(file) || /^packages\/infra\/global\/(?:lib|bin)\//u.test(file)),
    );
}

describe('no CDK app builds a docker image asset', () => {
    const sources = cdkSources();

    it('sweeps the CDK sources', () => {
        // A walk that matched nothing would pass every file vacuously.
        expect(sources.length).toBeGreaterThan(30);
        expect(sources).toContain('packages/infra/global/bin/app.ts');
        expect(sources).toContain('packages/services/identity/infra/lib/IdentityServiceStack.ts');
    });

    it('uses no docker image asset construct', () => {
        const offenders = sources.flatMap((file) =>
            imageAssetUses(file, readFileSync(path.join(repoRoot, file), 'utf8')).map((use) => `${file}: ${use}`),
        );

        expect(offenders).toEqual([]);
    });
});

describe('imageAssetUses (negative controls: the guard can fail)', () => {
    it('accepts an image referenced from ECR, which is what the stacks do', () => {
        const source = `ecs.ContainerImage.fromEcrRepository(repository, tag); ecr.Repository.fromRepositoryName(a, 'r', 'n');`;

        expect(imageAssetUses('ok.ts', source)).toEqual([]);
    });

    it.each([
        ['new DockerImageAsset(this, "i", { directory: "." })', 'DockerImageAsset'],
        ['new DockerImageFunction(this, "f", { code })', 'DockerImageFunction'],
        ['ecs.ContainerImage.fromAsset(".")', 'ContainerImage.fromAsset'],
        ['lambda.Code.fromAssetImage(".")', 'Code.fromAssetImage'],
        ['lambda.Code.fromDockerBuild(".")', 'Code.fromDockerBuild'],
        ['ContainerImage.fromTarball("x.tar")', 'ContainerImage.fromTarball'],
    ])('rejects %s', (source, expected) => {
        expect(imageAssetUses('bad.ts', source)).toContain(expected);
    });

    it('does not take a mention in a comment or a string for a use', () => {
        const source = `// never use DockerImageAsset\nconst note = 'ContainerImage.fromAsset';`;

        expect(imageAssetUses('ok.ts', source)).toEqual([]);
    });
});
