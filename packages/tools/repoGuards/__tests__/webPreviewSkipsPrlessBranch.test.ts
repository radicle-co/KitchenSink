// @vitest-environment node
/**
 * Repo-wide guard: **Vercel does not build a preview of a branch that has no pull request yet.**
 *
 * A branch's first push always precedes `gh pr create`, so Vercel's own build of it has no
 * `VERCEL_GIT_PULL_REQUEST_ID`, and `scripts/previewEndpoints.ts` fails that build on purpose (it cannot name the
 * PR's recipe service). CI deploys the preview itself when the PR opens (`sandbox-web-preview.yml`), so the failed
 * build was noise. `ignoreCommand` in `vercel.json` skips it: exit 0 skips the build, exit 1 builds (the inverse of
 * the usual shell meaning).
 *
 * The command is run in a shell with each environment, so an edit that breaks the skip, or skips a build that is
 * needed, fails here.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { parseModule } from './appSources.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const VERCEL_JSON = path.join(repoRoot, 'packages/apps/commise/web/vercel.json');
const PREVIEW_ENDPOINTS = path.join(repoRoot, 'packages/apps/commise/web/scripts/previewEndpoints.ts');

const SKIP = 0;
const BUILD = 1;

function ignoreCommand(): string {
    const config = JSON.parse(readFileSync(VERCEL_JSON, 'utf8')) as { readonly ignoreCommand?: unknown };

    if (typeof config.ignoreCommand !== 'string') {
        throw new Error('vercel.json has no ignoreCommand');
    }

    return config.ignoreCommand;
}

/** The exit code Vercel reads, for a build whose environment is exactly `environment`. */
function verdict(environment: Readonly<Record<string, string>>): number | null {
    return spawnSync('/bin/sh', ['-c', ignoreCommand()], { env: { PATH: '/usr/bin:/bin', ...environment } }).status;
}

/** The names in `PR_NUMBER_SOURCES = [...] as const` of previewEndpoints.ts, read from its syntax tree. */
function prNumberSources(): readonly string[] {
    const file = parseModule(PREVIEW_ENDPOINTS, readFileSync(PREVIEW_ENDPOINTS, 'utf8'));
    const declaration = file.statements
        .filter(ts.isVariableStatement)
        .flatMap((statement) => [...statement.declarationList.declarations])
        .find((candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === 'PR_NUMBER_SOURCES');
    const initializer = declaration?.initializer;
    const list = initializer !== undefined && ts.isAsExpression(initializer) ? initializer.expression : initializer;

    if (list === undefined || !ts.isArrayLiteralExpression(list)) {
        throw new Error('previewEndpoints.ts has no PR_NUMBER_SOURCES array');
    }

    return list.elements.filter(ts.isStringLiteralLike).map((element) => element.text);
}

describe('vercel.json ignoreCommand', () => {
    it('skips a preview that has no pull request number', () => {
        expect(verdict({ VERCEL_ENV: 'preview', VERCEL_GIT_PULL_REQUEST_ID: '' })).toBe(SKIP);
    });

    it('skips a preview whose pull request variable is unset', () => {
        expect(verdict({ VERCEL_ENV: 'preview' })).toBe(SKIP);
    });

    it('builds a preview that belongs to a pull request', () => {
        expect(verdict({ VERCEL_ENV: 'preview', VERCEL_GIT_PULL_REQUEST_ID: '418' })).toBe(BUILD);
    });

    it('builds a preview that CI gave an explicit number', () => {
        expect(verdict({ VERCEL_ENV: 'preview', PREVIEW_PR_NUMBER: '418' })).toBe(BUILD);
    });

    it.each(['production', 'development'])('builds a %s deployment without a pull request', (vercelEnv) => {
        expect(verdict({ VERCEL_ENV: vercelEnv, VERCEL_GIT_PULL_REQUEST_ID: '' })).toBe(BUILD);
    });

    it('builds when Vercel does not say what the environment is', () => {
        expect(verdict({})).toBe(BUILD);
    });

    it('names every pull request source that previewEndpoints.ts reads, or a build that needs one would be skipped', () => {
        const names = prNumberSources();

        expect(names.length).toBeGreaterThan(0);

        for (const name of names) {
            expect(ignoreCommand(), `${name} is missing from ignoreCommand`).toContain(`"$${name}"`);
        }
    });
});
