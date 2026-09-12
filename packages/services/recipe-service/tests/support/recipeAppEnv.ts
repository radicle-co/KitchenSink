/**
 * The env the recipe `AppModule` needs to boot, beyond the database and its three queues: applied only when absent,
 * so CI and local overrides win. One definition for every tier that boots the app, including the mocked integration
 * tier. Each boot names the queues itself: the e2e harness the ones its global setup provisions, the mocked app a
 * closed port.
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
    // REQUIRED since issue #120 — the app refuses to boot without a food origin, deliberately (the old
    // in-code `http://localhost:3002` default is what silently pointed the deployed service at itself).
    // Nothing listens here, which is what makes the F2 specs a real absent-dependency proof.
    FOOD_SERVICE_URL: 'http://localhost:3002',
};
