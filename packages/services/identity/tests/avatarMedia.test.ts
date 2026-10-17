/**
 * The avatar media path (ADR-0064): the S3 storage adapter, the CloudFront invalidation adapter, the facade that
 * composes them, and the configuration that must be present when deployed.
 *
 * | Requirement                                                                        | Test                                       |
 * | ---------------------------------------------------------------------------------- | ------------------------------------------ |
 * | D3: the presigned PUT carries no flexible-checksum parameter                       | 'signs no flexible-checksum parameter'     |
 * | the bucket is never defaulted (fail closed)                                         | 'resolveMediaConfig'                       |
 * | HEAD 404 is "not there"; any other HEAD failure is an error, never "not there"      | 'exists'                                   |
 * | replacement deletes every OTHER object under the user's prefix, never the new one   | 'deleteUnder'                              |
 * | deletion pages through a truncated listing                                          | 'pages through a truncated listing'        |
 * | delete first, then invalidate `/avatars/{id}/*`; either failing is an ERROR         | 'AvatarMedia'                              |
 * | an unconfigured process refuses to touch storage                                    | 'unconfigured'                             |
 */
import { describe, expect, it, vi } from 'vitest';

import { resolveMediaConfig, MediaConfigError, isMediaConfigError } from '../src/config/mediaConfig.js';
import { AvatarMedia, unconfiguredAvatarMedia } from '../src/users/avatarMedia.js';
import { createS3AvatarStorage, type AvatarStoragePort } from '../src/users/avatarStorage.js';
import type { CdnInvalidationPort } from '../src/users/cdnInvalidation.js';

const USER = '01J8ZQ4Y0V3W6X7A8B9C0D1E2F';

describe('createS3AvatarStorage', () => {
    const storage = (send: ReturnType<typeof vi.fn> = vi.fn()): AvatarStoragePort =>
        createS3AvatarStorage({ bucket: 'media-bucket', region: 'us-east-1', client: { send } as never });

    it('signs no flexible-checksum parameter into the presigned query (D3)', async () => {
        const real = createS3AvatarStorage({
            bucket: 'media-bucket',
            region: 'us-east-1',
            credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        });

        const uploadUrl = await real.presignUpload({
            key: `avatars/${USER}/1.png`,
            contentType: 'image/png',
            size: 10,
        });
        const names = [...new URL(uploadUrl).searchParams.keys()].map((name) => name.toLowerCase());

        expect(names.filter((name) => name.includes('checksum'))).toEqual([]);
        expect(uploadUrl).toContain(`avatars/${USER}/1.png`);
        // The signature binds the type and the length, so S3 itself rejects a different object.
        expect(new URL(uploadUrl).searchParams.get('X-Amz-SignedHeaders')).toContain('content-length');
    });

    describe('exists', () => {
        it('is true when HEAD answers', async () => {
            await expect(storage(vi.fn().mockResolvedValue({})).exists('k')).resolves.toBe(true);
        });

        it('is false on a not-found (404 / NotFound / NoSuchKey)', async () => {
            for (const error of [
                { name: 'NotFound', $metadata: { httpStatusCode: 404 } },
                { name: 'NoSuchKey' },
                { $metadata: { httpStatusCode: 404 } },
            ]) {
                await expect(storage(vi.fn().mockRejectedValue(error)).exists('k')).resolves.toBe(false);
            }
        });

        it('REJECTS any other failure instead of reporting "not there"', async () => {
            const denied = Object.assign(new Error('denied'), {
                name: 'AccessDenied',
                $metadata: { httpStatusCode: 403 },
            });

            await expect(storage(vi.fn().mockRejectedValue(denied)).exists('k')).rejects.toBe(denied);
        });
    });

    describe('deleteUnder', () => {
        it('deletes every object under the prefix except the one to keep', async () => {
            const send = vi
                .fn()
                .mockResolvedValueOnce({
                    Contents: [
                        { Key: `avatars/${USER}/1.png` },
                        { Key: `avatars/${USER}/2.png` },
                        { Key: `avatars/${USER}/3.png` },
                    ],
                    IsTruncated: false,
                })
                .mockResolvedValueOnce({});

            const deleted = await storage(send).deleteUnder(`avatars/${USER}/`, `avatars/${USER}/2.png`);

            expect(deleted).toBe(2);
            const remove = send.mock.calls[1]?.[0] as { input: { Delete: { Objects: Array<{ Key: string }> } } };
            expect(remove.input.Delete.Objects.map((object) => object.Key)).toEqual([
                `avatars/${USER}/1.png`,
                `avatars/${USER}/3.png`,
            ]);
        });

        it('lists only the prefix it was given', async () => {
            const send = vi.fn().mockResolvedValue({ Contents: [], IsTruncated: false });

            await storage(send).deleteUnder(`avatars/${USER}/`);

            const [listing] = send.mock.calls[0] as [{ input: { Prefix: string } }];

            expect(listing.input.Prefix).toBe(`avatars/${USER}/`);
        });

        it('deletes everything when nothing is kept', async () => {
            const send = vi
                .fn()
                .mockResolvedValueOnce({ Contents: [{ Key: `avatars/${USER}/1.png` }], IsTruncated: false })
                .mockResolvedValueOnce({});

            await expect(storage(send).deleteUnder(`avatars/${USER}/`)).resolves.toBe(1);
        });

        it('pages through a truncated listing', async () => {
            const send = vi
                .fn()
                .mockResolvedValueOnce({
                    Contents: [{ Key: `avatars/${USER}/1.png` }],
                    IsTruncated: true,
                    NextContinuationToken: 'next',
                })
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({ Contents: [{ Key: `avatars/${USER}/2.png` }], IsTruncated: false })
                .mockResolvedValueOnce({});

            await expect(storage(send).deleteUnder(`avatars/${USER}/`)).resolves.toBe(2);
            const [secondListing] = send.mock.calls[2] as [{ input: { ContinuationToken: string } }];

            expect(secondListing.input.ContinuationToken).toBe('next');
        });

        it('REJECTS a failed delete rather than reporting success', async () => {
            const send = vi
                .fn()
                .mockResolvedValueOnce({ Contents: [{ Key: `avatars/${USER}/1.png` }], IsTruncated: false })
                .mockRejectedValueOnce(new Error('boom'));

            await expect(storage(send).deleteUnder(`avatars/${USER}/`)).rejects.toThrow('boom');
        });

        it('REJECTS an empty prefix, which would list the whole bucket', async () => {
            const send = vi.fn();

            await expect(storage(send).deleteUnder('')).rejects.toThrow(/prefix/iu);
            expect(send).not.toHaveBeenCalled();
        });
    });
});

describe('AvatarMedia', () => {
    const fakes = (): { storage: AvatarStoragePort; cdn: CdnInvalidationPort; order: string[] } => {
        const order: string[] = [];

        return {
            order,
            storage: {
                presignUpload: vi.fn().mockResolvedValue('https://signed'),
                exists: vi.fn().mockResolvedValue(true),
                deleteUnder: vi.fn().mockImplementation(() => {
                    order.push('delete');

                    return Promise.resolve(1);
                }),
            },
            cdn: {
                invalidate: vi.fn().mockImplementation(() => {
                    order.push('invalidate');

                    return Promise.resolve();
                }),
            },
        };
    };

    const media = (parts: ReturnType<typeof fakes>): AvatarMedia =>
        new AvatarMedia(parts.storage, parts.cdn, 'https://media.commise.app');

    it('exposes the CDN base URL for read-time composition', () => {
        expect(media(fakes()).cdnUrl).toBe('https://media.commise.app');
    });

    it('removeSuperseded deletes the OTHER objects, then invalidates the whole prefix', async () => {
        const parts = fakes();

        await media(parts).removeSuperseded(USER, `avatars/${USER}/2.png`);

        expect(parts.storage.deleteUnder).toHaveBeenCalledWith(`avatars/${USER}/`, `avatars/${USER}/2.png`);
        expect(parts.cdn.invalidate).toHaveBeenCalledWith([`/avatars/${USER}/*`]);
        expect(parts.order).toEqual(['delete', 'invalidate']);
    });

    it('removeAll deletes everything under the prefix, then invalidates it', async () => {
        const parts = fakes();

        await media(parts).removeAll(USER);

        expect(parts.storage.deleteUnder).toHaveBeenCalledWith(`avatars/${USER}/`, undefined);
        expect(parts.cdn.invalidate).toHaveBeenCalledWith([`/avatars/${USER}/*`]);
        expect(parts.order).toEqual(['delete', 'invalidate']);
    });

    it('does not invalidate when the delete failed, and the failure reaches the caller', async () => {
        const parts = fakes();
        vi.mocked(parts.storage.deleteUnder).mockRejectedValue(new Error('s3 down'));

        await expect(media(parts).removeAll(USER)).rejects.toThrow('s3 down');
        expect(parts.cdn.invalidate).not.toHaveBeenCalled();
    });

    it('REJECTS when the invalidation fails: an erased photo may not stay cached silently', async () => {
        const parts = fakes();
        vi.mocked(parts.cdn.invalidate).mockRejectedValue(new Error('cloudfront down'));

        await expect(media(parts).removeAll(USER)).rejects.toThrow('cloudfront down');
    });

    it('delegates presign and existence to storage', async () => {
        const parts = fakes();

        await expect(media(parts).presignUpload({ key: 'k', contentType: 'image/png', size: 1 })).resolves.toBe(
            'https://signed',
        );
        await expect(media(parts).exists('k')).resolves.toBe(true);
    });

    describe('unconfigured', () => {
        it('refuses every operation rather than guessing a bucket', async () => {
            const unconfigured = unconfiguredAvatarMedia();

            await expect(unconfigured.presignUpload({ key: 'k', contentType: 'image/png', size: 1 })).rejects.toThrow(
                /not configured/iu,
            );
            await expect(unconfigured.exists('k')).rejects.toThrow(/not configured/iu);
            await expect(unconfigured.removeAll(USER)).rejects.toThrow(/not configured/iu);
            await expect(unconfigured.removeSuperseded(USER, 'k')).rejects.toThrow(/not configured/iu);
        });
    });
});

describe('resolveMediaConfig', () => {
    const full = {
        MEDIA_BUCKET_NAME: 'media-bucket',
        MEDIA_CDN_URL: 'https://media.commise.app',
        MEDIA_DISTRIBUTION_ID: 'E123',
    };

    it('reads all three when present', () => {
        expect(resolveMediaConfig({ STAGE: 'prod', ...full })).toMatchObject({
            bucket: 'media-bucket',
            cdnUrl: 'https://media.commise.app',
            distributionId: 'E123',
        });
    });

    it.each(['MEDIA_BUCKET_NAME', 'MEDIA_CDN_URL', 'MEDIA_DISTRIBUTION_ID'] as const)(
        'THROWS on a deployed stage without %s — there is no dev default',
        (name) => {
            const env = { STAGE: 'sandbox', ...full, [name]: undefined };

            expect(() => resolveMediaConfig(env)).toThrow(MediaConfigError);

            try {
                resolveMediaConfig(env);
            } catch (error) {
                expect(isMediaConfigError(error)).toBe(true);
                expect((error as Error).message).toContain(name);
            }
        },
    );

    it('treats a blank value as absent', () => {
        expect(() => resolveMediaConfig({ STAGE: 'prod', ...full, MEDIA_CDN_URL: '  ' })).toThrow(MediaConfigError);
    });

    it('is undefined off a deployed stage with no bucket: avatar routes refuse instead of defaulting', () => {
        expect(resolveMediaConfig({ STAGE: 'test' })).toBeUndefined();
        expect(resolveMediaConfig({})).toBeUndefined();
    });

    it('off a deployed stage, a bucket alone is enough and the CDN is optional (LocalStack)', () => {
        expect(
            resolveMediaConfig({ STAGE: 'local', MEDIA_BUCKET_NAME: 'b', S3_ENDPOINT: 'http://127.0.0.1:4566' }),
        ).toMatchObject({ bucket: 'b', endpoint: 'http://127.0.0.1:4566' });
    });

    it('never carries an endpoint onto a deployed stage', () => {
        expect(resolveMediaConfig({ STAGE: 'prod', ...full, S3_ENDPOINT: 'http://evil' })?.endpoint).toBeUndefined();
    });
});
