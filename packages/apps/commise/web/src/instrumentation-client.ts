import * as Sentry from '@sentry/nextjs';

import { DEPLOY_STAGE, RELEASE, tracesSampleRateFor } from './lib/sentryStage';

import { scrubEvent, scrubLog } from './lib/sentryScrubbers';

Sentry.init({
    dsn: process.env['NEXT_PUBLIC_SENTRY_DSN'],
    // ⛔ THE DEPLOY STAGE, NOT `NODE_ENV` (plan U19). Next sets `NODE_ENV` to `production` for every
    // production build — including every preview — so every `pr-{N}` deploy reported into the `production`
    // environment, mixed with the events from the deploy real users are on. That is worse than no tag: it
    // makes the production filter untrustworthy in the one direction nobody checks.
    environment: DEPLOY_STAGE,
    ...(RELEASE ? { release: RELEASE } : {}),
    enableLogs: true,
    sendDefaultPii: false,
    tracesSampleRate: tracesSampleRateFor(DEPLOY_STAGE),
    beforeSend: scrubEvent,
    beforeSendLog: scrubLog,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
