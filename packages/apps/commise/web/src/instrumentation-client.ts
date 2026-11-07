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
    // One release-health session per DOCUMENT LOAD. The default (`lifecycle: 'route'`) starts a new session on every
    // history write that changes the address, and this app writes the address for state, not for visits. An array
    // (not a function) keeps every other default integration; this one replaces the default of the same name.
    integrations: [Sentry.browserSessionIntegration({ lifecycle: 'page' })],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
