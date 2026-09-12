import { SEED_ERASURE_QUEUE_URL, SEED_PARSE_QUEUE_URL, SEED_VERIFICATION_QUEUE_URL } from '../globalSetup.js';

/**
 * The env the recipe `AppModule` needs to boot, beyond the database: applied only when absent, so CI and local
 * overrides win. One definition for every tier that boots the app, including the mocked integration tier.
 */
export const RECIPE_APP_ENV_DEFAULTS: Readonly<Record<string, string>> = {
    CLERK_JWT_KEY: 'e2e-harness-placeholder-key',
    CLERK_AUTHORIZED_PARTIES: 'http://localhost:3000',
    S3_ENDPOINT: 'http://localhost:4566',
    S3_FORCE_PATH_STYLE: 'true',
    S3_BUCKET_PHOTOS: 'commise-photos',
    S3_BUCKET_VERSIONS: 'commise-versions',
    CLOUDFRONT_URL: 'http://localhost:4566/commise-photos',
    SQS_ENDPOINT: 'http://localhost:4566',
    // The queue the global setup actually provisions — one definition, so the booted app and the
    // specs draining the queue can never address different queues.
    ACCOUNT_ERASURE_QUEUE_URL: SEED_ERASURE_QUEUE_URL,
    // The verification gate's queue (plan U11 / ADR-0024). REQUIRED like the food origin below and
    // for the same reason: `ingredientVerificationConfigSchema` refuses to boot without it, because
    // U11 shipped the gate's consumer with nothing producing a message and every check stayed green.
    INGREDIENT_VERIFICATION_QUEUE_URL: SEED_VERIFICATION_QUEUE_URL,
    RECIPE_PARSE_QUEUE_URL: SEED_PARSE_QUEUE_URL,
    // REQUIRED since issue #120 — the app refuses to boot without a food origin, deliberately (the old
    // in-code `http://localhost:3002` default is what silently pointed the deployed service at itself).
    // Nothing listens here, which is what makes the F2 specs a real absent-dependency proof.
    FOOD_SERVICE_URL: 'http://localhost:3002',
};
