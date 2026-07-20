/**
 * S-I1 unit/integration coverage complementing the HTTP e2e (`tests/e2e/users-validation.e2e.test.ts`):
 *
 * 1. Wiring guard — `AppModule` binds the `ValidationPipe` to the `APP_PIPE` token (the ONLY binding
 *    that registers a pipe globally), not the inert bare `ValidationPipe` class token it regressed from.
 * 2. Behavior — the real `ValidationPipe` + the real `PatchUserMeBodyDto` decorators reject an over-long
 *    displayName, a non-URL avatarUrl, and unknown fields, and accept a valid body. This pins the DTO
 *    decorators themselves (the e2e pins the global wiring).
 *
 * @module
 */
import 'reflect-metadata';

import { describe, it, expect, beforeAll } from 'vitest';
import { ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';

import { PatchUserMeBodyDto } from '../src/users/dto/user.dto.js';

interface ProviderBinding {
    readonly provide?: unknown;
    readonly useValue?: unknown;
}

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
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

        it('registers a ValidationPipe under the APP_PIPE token', () => {
            const binding = providers.find((p) => p.provide === APP_PIPE);

            expect(binding).toBeDefined();
            expect(binding?.useValue).toBeInstanceOf(ValidationPipe);
        });

        it('does NOT bind the inert bare ValidationPipe class token', () => {
            expect(providers.find((p) => p.provide === ValidationPipe)).toBeUndefined();
        });
    });

    describe('ValidationPipe + PatchUserMeBodyDto', () => {
        it('rejects a displayName longer than 100 chars', async () => {
            await expect(pipe.transform({ displayName: 'x'.repeat(101) }, bodyMeta)).rejects.toThrow();
        });

        it('rejects an avatarUrl that is not a URL', async () => {
            await expect(pipe.transform({ avatarUrl: 'not-a-url' }, bodyMeta)).rejects.toThrow();
        });

        it('rejects an unknown field (forbidNonWhitelisted)', async () => {
            await expect(pipe.transform({ displayName: 'Valid', hacker: 'x' }, bodyMeta)).rejects.toThrow();
        });

        it('accepts a valid body and returns a typed instance', async () => {
            const result = await pipe.transform(
                { displayName: 'Morgan', avatarUrl: 'https://img.example/x.png' },
                bodyMeta,
            );

            expect(result).toBeInstanceOf(PatchUserMeBodyDto);
            expect(result).toMatchObject({ displayName: 'Morgan', avatarUrl: 'https://img.example/x.png' });
        });

        it('accepts an empty body (both fields optional)', async () => {
            await expect(pipe.transform({}, bodyMeta)).resolves.toBeInstanceOf(PatchUserMeBodyDto);
        });
    });
});
