// ⚠️ DELIBERATE — see docs/architecture/decisions/0001-sandbox-front-end-addressing.md
// Per-PR lifecycle for the single-origin sandbox router (U5): write `pr-{N} → <preview host>` into
// the router's CloudFront KeyValueStore when a PR's preview is ready, delete it when the PR closes.
// This is the ONLY Vercel-specific seam — leaving Vercel means feeding ECS hosts here instead; the
// router + app are unchanged. KVS writes are optimistic-concurrency (IfMatch ETag) → read-modify-retry.
import {
    CloudFrontKeyValueStoreClient,
    DeleteKeyCommand,
    DescribeKeyValueStoreCommand,
    PutKeyCommand,
} from '@aws-sdk/client-cloudfront-keyvaluestore';

export interface KvsSender {
    send: CloudFrontKeyValueStoreClient['send'];
}

const errName = (err: unknown): string | undefined =>
    typeof err === 'object' && err !== null ? (err as { name?: string }).name : undefined;

const isConflict = (err: unknown): boolean => errName(err) === 'ConflictException';
const isNotFound = (err: unknown): boolean => errName(err) === 'ResourceNotFoundException';

/** Normalize + validate a preview host: bare hostname only (no scheme/path/whitespace). */
function normalizeHost(host: string): string {
    const normalized = host
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*$/, '');

    if (!normalized || /[\s/]/.test(normalized)) {
        throw new Error(`register-preview: invalid preview host '${host}' (expected a bare hostname)`);
    }

    return normalized;
}

/** Optimistic-concurrency PUT: describe for the current ETag, put, retry on a concurrent-write conflict. */
export async function putKey(
    client: KvsSender,
    kvsArn: string,
    key: string,
    value: string,
    maxAttempts = 4,
): Promise<void> {
    for (let attempt = 1; ; attempt++) {
        const { ETag } = await client.send(new DescribeKeyValueStoreCommand({ KvsARN: kvsArn }));

        try {
            await client.send(new PutKeyCommand({ KvsARN: kvsArn, Key: key, Value: value, IfMatch: ETag }));

            return;
        } catch (err) {
            if (isConflict(err) && attempt < maxAttempts) {
                continue;
            }

            throw err;
        }
    }
}

/** Optimistic-concurrency DELETE (no-op-safe is the caller's concern). */
export async function deleteKey(client: KvsSender, kvsArn: string, key: string, maxAttempts = 4): Promise<void> {
    for (let attempt = 1; ; attempt++) {
        const { ETag } = await client.send(new DescribeKeyValueStoreCommand({ KvsARN: kvsArn }));

        try {
            await client.send(new DeleteKeyCommand({ KvsARN: kvsArn, Key: key, IfMatch: ETag }));

            return;
        } catch (err) {
            if (isConflict(err) && attempt < maxAttempts) {
                continue;
            }

            throw err;
        }
    }
}

export async function registerPreview(
    client: KvsSender,
    kvsArn: string,
    prNumber: string,
    host: string,
): Promise<void> {
    if (!host) {
        throw new Error(`register-preview: empty preview host for pr-${prNumber} (preview not READY?)`);
    }

    await putKey(client, kvsArn, `pr-${prNumber}`, normalizeHost(host));
}

/** Idempotent: a PR closed without a prior successful register (preview never READY) must not fail. */
export async function deregisterPreview(client: KvsSender, kvsArn: string, prNumber: string): Promise<void> {
    try {
        await deleteKey(client, kvsArn, `pr-${prNumber}`);
    } catch (err) {
        if (!isNotFound(err)) {
            throw err;
        }
    }
}

/** CLI entry: ACTION=register|deregister, PR_NUMBER, KVS_ARN, and (register) PREVIEW_HOST from env. */
async function main(): Promise<void> {
    const action = process.env['ACTION'];
    const prNumber = process.env['PR_NUMBER'];
    const kvsArn = process.env['KVS_ARN'];

    if (!action || !prNumber || !kvsArn) {
        throw new Error('register-preview: ACTION, PR_NUMBER and KVS_ARN are required');
    }

    const client = new CloudFrontKeyValueStoreClient({});

    if (action === 'register') {
        await registerPreview(client, kvsArn, prNumber, process.env['PREVIEW_HOST'] ?? '');
    } else if (action === 'deregister') {
        await deregisterPreview(client, kvsArn, prNumber);
    } else {
        throw new Error(`register-preview: unknown ACTION '${action}'`);
    }
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err: unknown) => {
        console.error(err);
        process.exit(1);
    });
}
