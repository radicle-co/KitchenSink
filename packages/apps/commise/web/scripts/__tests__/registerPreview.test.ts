import { describe, expect, it, vi } from 'vitest';
import {
    DeleteKeyCommand,
    DescribeKeyValueStoreCommand,
    PutKeyCommand,
} from '@aws-sdk/client-cloudfront-keyvaluestore';

import { deregisterPreview, putKey, registerPreview } from '../registerPreview';

const notFound = Object.assign(new Error('missing'), { name: 'ResourceNotFoundException' });

const ARN = 'arn:aws:cloudfront::123456789012:key-value-store/abc';

describe('register-preview KVS lifecycle', () => {
    it('register describes for the ETag then puts pr-{N} → host', async () => {
        const send = vi.fn().mockResolvedValueOnce({ ETag: 'v1' }).mockResolvedValueOnce({});

        await registerPreview({ send } as never, ARN, '123', 'app-abc.vercel.app');

        const [describeCmd, putCmd] = send.mock.calls.map((c) => c[0]);
        expect(describeCmd).toBeInstanceOf(DescribeKeyValueStoreCommand);
        expect(putCmd).toBeInstanceOf(PutKeyCommand);
        expect(putCmd.input).toMatchObject({
            KvsARN: ARN,
            Key: 'pr-123',
            Value: 'app-abc.vercel.app',
            IfMatch: 'v1',
        });
    });

    it('retries the put on a concurrent-write ConflictException, re-reading the ETag', async () => {
        const conflict = Object.assign(new Error('etag conflict'), { name: 'ConflictException' });
        const send = vi
            .fn()
            .mockResolvedValueOnce({ ETag: 'v1' }) // describe #1
            .mockRejectedValueOnce(conflict) // put #1 → conflict
            .mockResolvedValueOnce({ ETag: 'v2' }) // describe #2 (re-read)
            .mockResolvedValueOnce({}); // put #2 → ok

        await putKey({ send } as never, ARN, 'pr-1', 'h');

        expect(send).toHaveBeenCalledTimes(4);
    });

    it('deregister deletes pr-{N} with the current ETag', async () => {
        const send = vi.fn().mockResolvedValueOnce({ ETag: 'v9' }).mockResolvedValueOnce({});

        await deregisterPreview({ send } as never, ARN, '7');

        const deleteCmd = send.mock.calls[1]![0];
        expect(deleteCmd).toBeInstanceOf(DeleteKeyCommand);
        expect(deleteCmd.input).toMatchObject({ KvsARN: ARN, Key: 'pr-7', IfMatch: 'v9' });
    });

    it('register fails loudly on an empty preview host (preview not READY)', async () => {
        const send = vi.fn();

        await expect(registerPreview({ send } as never, ARN, '5', '')).rejects.toThrow(/empty preview host/);
        expect(send).not.toHaveBeenCalled();
    });

    it('register normalizes a host that includes a scheme/path to a bare hostname', async () => {
        const send = vi.fn().mockResolvedValueOnce({ ETag: 'v1' }).mockResolvedValueOnce({});

        await registerPreview({ send } as never, ARN, '1', 'https://app-x.vercel.app/pr-1/');

        expect(send.mock.calls[1]![0].input.Value).toBe('app-x.vercel.app');
    });

    it('register rejects a malformed host before writing', async () => {
        const send = vi.fn();

        await expect(registerPreview({ send } as never, ARN, '1', 'bad host')).rejects.toThrow(/invalid preview host/);
        expect(send).not.toHaveBeenCalled();
    });

    it('deregister swallows a not-found (PR closed without a prior register)', async () => {
        const send = vi.fn().mockResolvedValueOnce({ ETag: 'v1' }).mockRejectedValueOnce(notFound);

        await expect(deregisterPreview({ send } as never, ARN, '5')).resolves.toBeUndefined();
    });

    it('deregister re-throws non-not-found errors', async () => {
        const boom = Object.assign(new Error('boom'), { name: 'ThrottlingException' });
        const send = vi.fn().mockResolvedValueOnce({ ETag: 'v1' }).mockRejectedValueOnce(boom);

        await expect(deregisterPreview({ send } as never, ARN, '5')).rejects.toThrow('boom');
    });
});
