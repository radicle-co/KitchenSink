import * as Sentry from '@sentry/nextjs';

import { scrubEvent, scrubLog } from './lib/sentryScrubbers';

Sentry.init({
    dsn: process.env['NEXT_PUBLIC_SENTRY_DSN'],
    environment: process.env['NODE_ENV'],
    enableLogs: true,
    sendDefaultPii: false,
    tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.1 : 1.0,
    beforeSend: scrubEvent,
    beforeSendLog: scrubLog,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
