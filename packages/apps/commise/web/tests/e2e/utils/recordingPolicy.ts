/**
 * What the suite records of a test, and when.
 *
 * Recording costs CPU in every test that does it, and a passing test has no use for the result. So a trace and a video
 * are made only when a test is retried (the first attempt failed), and a screenshot only for a failed test. Applied
 * once, to the config's `use`, so every project records the same way.
 */
export const RECORDING = {
    trace: 'on-first-retry',
    video: 'on-first-retry',
    screenshot: 'only-on-failure',
} as const;
