/**
 * S-I1 unit/integration coverage complementing the HTTP e2e (`tests/e2e/usersValidation.e2e.test.ts`):
 *
 * 1. Wiring guard — `AppModule` binds a pipe to the `APP_PIPE` token (the ONLY binding that registers a pipe
 *    globally), not the inert bare class token it regressed from, AND that pipe is `nestjs-zod`'s.
 * 2. Behavior — the real pipe + the real `PatchUserMeBodyDto` reject an over-long displayName, a non-URL
 *    avatarUrl, and unknown fields, and accept a valid body.
 *
 * ⚠️ WHY THE PIPE'S IDENTITY IS ASSERTED, not just its presence. The DTOs are now `createZodDto` classes over the
 * AUTHORED wire schemas (CODING_STANDARDS §15.2), so they carry NO `class-validator` metadata. Bound to Nest's own
 * `ValidationPipe`, `PatchUserMeBodyDto` would validate NOTHING while looking correctly wired — a strictly worse
 * failure than the original S-I1 bug, on a route that writes user data. Asserting only "some pipe is bound" would
 * pass in that state, so this file pins WHICH pipe and proves Nest's cannot substitute for it.
 *
 * That is not hypothetical: it was MEASURED while making this change. Under Nest's `ValidationPipe`, four of the
 * five behaviour cases below still "passed" against the Zod DTO — because `whitelist: true` stripped every
 * property (there is no class-validator metadata to whitelist) and `forbidNonWhitelisted: true` then rejected the
 * result. Every rejection was right by accident, for the wrong reason, and the VALID-body case was rejected too.
 * A suite that only checked the four rejections would have gone green on a pipe validating nothing.
 *
 * @module
 */
import 'reflect-metadata';

import { describe, it, expect, beforeAll } from 'vitest';
import { ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';

import { PatchUserMeBodyDto } from '../src/users/dto/user.dto.js';

interface ProviderBinding {
    readonly provide?: unknown;
    readonly useValue?: unknown;
}

const pipe = new ZodValidationPipe();
const bodyMeta: ArgumentMetadata = { type: 'body', metatype: PatchUserMeBodyDto, data: '' };

describe('S-I1 — global DTO validation', () => {
    describe('AppModule wiring', () => {
        let providers: ProviderBinding[];

        beforeAll(async () => {
            // Importing AppModule builds AppConfigModule, which validates process.env eagerly — set the
            // minimum the schema needs first (STAGE=dev skips the Clerk requirements). Reading provider
            // metadata does NOT instantiate anything (no NestFactory), so no pg/SQS mocking is needed.
            process.env['STAGE'] ??= 'dev';
            process.env['DATABASE_URL'] ??= 'postgresql://identity:identity@localhost:5432/kitchensink_identity';
            process.env['DELETION_QUEUE_URL'] ??= 'https://sqs.localhost/000000000000/identity-deletion';

            const mod = await import('../src/app.module.js');
            providers = (Reflect.getMetadata('providers', mod.AppModule) as ProviderBinding[]) ?? [];
        });

        it("registers nestjs-zod's ZodValidationPipe under the APP_PIPE token", () => {
            const binding = providers.find((p) => p.provide === APP_PIPE);

            expect(binding).toMatchObject({ provide: APP_PIPE });
            expect(binding?.useValue).toBeInstanceOf(ZodValidationPipe);
        });

        it('does NOT bind the inert bare pipe class token', () => {
            expect(providers.find((p) => p.provide === ZodValidationPipe)).toBeUndefined();
            expect(providers.find((p) => p.provide === ValidationPipe)).toBeUndefined();
        });

        // The regression this file exists to prevent. If someone "restores" Nest's pipe, every Zod DTO silently
        // stops being validated — so the wrong pipe must be an explicit failure, not an unnoticed substitution.
        it("does NOT bind Nest's own ValidationPipe, which cannot validate a Zod DTO", () => {
            const binding = providers.find((p) => p.provide === APP_PIPE);

            expect(binding?.useValue).not.toBeInstanceOf(ValidationPipe);
        });
    });

    // `ZodValidationPipe.transform` is SYNCHRONOUS — it returns parsed data or throws immediately — unlike
    // Nest's own pipe, which is async. Asserting with `.rejects`/`.resolves` here would fail on the promise check
    // rather than on the validation, so these cases are written synchronously on purpose.
    describe('ZodValidationPipe + PatchUserMeBodyDto', () => {
        it('rejects a displayName longer than 100 chars', () => {
            expect(() => pipe.transform({ displayName: 'x'.repeat(101) }, bodyMeta)).toThrow();
        });

        it('accepts a displayName of exactly 100 chars (the boundary is inclusive)', () => {
            expect(pipe.transform({ displayName: 'x'.repeat(100) }, bodyMeta)).toMatchObject({
                displayName: 'x'.repeat(100),
            });
        });

        it('rejects an avatarUrl that is not a URL', () => {
            expect(() => pipe.transform({ avatarUrl: 'not-a-url' }, bodyMeta)).toThrow();
        });

        // A deliberate TIGHTENING over the `class-validator` `@IsUrl()` this replaced, which accepted a bare
        // `example.com/x.png`. The value is rendered as an image source, and every real avatar URL comes back
        // from this service's own presign route as an absolute `https://` S3 URL.
        it('rejects a scheme-less avatarUrl, which the previous @IsUrl() accepted', () => {
            expect(() => pipe.transform({ avatarUrl: 'img.example/x.png' }, bodyMeta)).toThrow();
        });

        it('accepts a null avatarUrl, which is how the avatar is CLEARED', () => {
            expect(pipe.transform({ avatarUrl: null }, bodyMeta)).toMatchObject({ avatarUrl: null });
        });

        // The `forbidNonWhitelisted` behaviour of the pipe this replaced. zod's plain `z.object()` STRIPS unknown
        // keys silently, so `users.schema.ts` uses `z.strictObject` — this is the assertion that keeps it there.
        it('rejects an unknown field rather than silently stripping it', () => {
            expect(() => pipe.transform({ displayName: 'Valid', hacker: 'x' }, bodyMeta)).toThrow();
        });

        it('accepts a valid body and returns the parsed data', () => {
            const result = pipe.transform({ displayName: 'Morgan', avatarUrl: 'https://img.example/x.png' }, bodyMeta);

            expect(result).toStrictEqual({ displayName: 'Morgan', avatarUrl: 'https://img.example/x.png' });
        });

        it('accepts an empty body (both fields optional)', () => {
            expect(pipe.transform({}, bodyMeta)).toStrictEqual({});
        });

        // Proof, not assertion-by-comment, that the pipe swap was NECESSARY: Nest's pipe rejects even a VALID
        // body against this DTO, because it whitelists by class-validator metadata the DTO does not have.
        it("PROOF: Nest's ValidationPipe cannot validate this DTO — it rejects a valid body", async () => {
            const nestPipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

            await expect(
                nestPipe.transform({ displayName: 'Morgan', avatarUrl: 'https://img.example/x.png' }, bodyMeta),
            ).rejects.toThrow();
        });
    });
});
