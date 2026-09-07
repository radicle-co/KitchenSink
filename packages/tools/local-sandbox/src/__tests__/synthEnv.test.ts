/**
 * Repo-wide guard: the placeholder environment a synth needs is DERIVED, not listed.
 *
 * ## Why a hand-written `SYNTH_ENV` was the wrong answer
 *
 * The first attempt at this package hardcoded the variables CDK apps need. It got three of eight apps to
 * synthesise and the other five reported "X env var is required" one variable at a time —
 * `RECIPE_VPC_ID`, then `RECIPE_LAMBDA_SG_ID`, then whatever came next. Each addition is a hand edit, which
 * makes the constant exactly the artefact this whole package exists to abolish: a list that must be updated
 * whenever infrastructure changes, remembered by a human, outside the CDK.
 *
 * So the KEYS come from the app's own source — every `process.env['…']` it reads — and the VALUE is inferred
 * from the key's NAME. A new `FOO_VPC_ID` gets a syntactically valid VPC id the day it is written, with no
 * edit here, because the repo already names things consistently enough for the shape to be readable.
 *
 * ⚠️ Shape, not truth. These values exist to get a synth far enough to emit templates, and every one of them
 * feeds an address, an account or a tag — none of which changes which resource TYPES a stack declares. If
 * this module is ever used to derive real addresses, that assumption is the first thing to revisit.
 */
import { describe, expect, it } from 'vitest';

import { inferPlaceholder, requiredEnvKeys } from '../synthEnv.js';

describe('requiredEnvKeys', () => {
    it('finds bracket-notation reads, which is the only form this repo allows', () => {
        expect(requiredEnvKeys(["const a = process.env['DOMAIN_NAME'];", "process.env['FOOD_VPC_ID']"])).toEqual([
            'DOMAIN_NAME',
            'FOOD_VPC_ID',
        ]);
    });

    it('finds keys named through a requireEnv helper', () => {
        expect(requiredEnvKeys(["requireEnv('RECIPE_LAMBDA_SG_ID')"])).toContain('RECIPE_LAMBDA_SG_ID');
    });

    it('de-duplicates and sorts, so the environment is stable to diff', () => {
        expect(requiredEnvKeys(["process.env['B']", "process.env['A']", "process.env['B']"])).toEqual(['A', 'B']);
    });

    it('ignores lowercase or non-env-shaped matches', () => {
        expect(requiredEnvKeys(["process.env['notAnEnvVar']"])).toEqual([]);
    });
});

describe('inferPlaceholder', () => {
    it.each([
        ['FOOD_VPC_ID', /^vpc-[0-9a-f]+$/u],
        ['RECIPE_LAMBDA_SG_ID', /^sg-[0-9a-f]+$/u],
        ['SOME_SUBNET_ID', /^subnet-[0-9a-f]+$/u],
        ['RECIPE_FOOD_SERVICE_URL', /^https?:\/\//u],
        ['CLOUDFRONT_DISTRIBUTION_ID', /^[A-Z0-9]+$/u],
        ['DELETION_QUEUE_ARN', /^arn:aws:/u],
        ['CDK_DEFAULT_ACCOUNT', /^\d{12}$/u],
        ['AWS_ACCOUNT_ID', /^\d{12}$/u],
        ['CDK_DEFAULT_REGION', /^[a-z]{2}-[a-z]+-\d$/u],
        ['DEFAULT_AWS_REGION', /^[a-z]{2}-[a-z]+-\d$/u],
    ])('gives %s a value of the right SHAPE', (key, shape) => {
        expect(inferPlaceholder(key)).toMatch(shape);
    });

    it('gives a domain a resolvable-looking but reserved name', () => {
        // `.invalid` is reserved by RFC 2606 precisely so it can never resolve — a placeholder domain that
        // could accidentally be real is how a local tool reaches someone else's server.
        expect(inferPlaceholder('DOMAIN_NAME')).toMatch(/\.invalid$/u);
    });

    it('gives an unrecognised key a harmless token rather than an empty string', () => {
        // Empty would pass `process.env['X'] ?? fallback` and silently take the fallback path, so a synth
        // could succeed against a code path no deploy ever uses.
        const value = inferPlaceholder('SOMETHING_NOBODY_ANTICIPATED');

        expect(value.length).toBeGreaterThan(0);
        expect(value).toMatch(/local/iu);
    });

    it('is deterministic — the same key always yields the same value', () => {
        expect(inferPlaceholder('FOO_VPC_ID')).toBe(inferPlaceholder('FOO_VPC_ID'));
    });
});
