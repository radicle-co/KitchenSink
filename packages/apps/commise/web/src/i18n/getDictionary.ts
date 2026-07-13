import { resolveMessages, type Locale } from '@commise/i18n';

import { webMessages, type WebMessages } from './messages.js';

/**
 * Resolve the web app's copy for `locale`, falling back to the default (en) set. Server-usable (no React,
 * no context) — Next.js server components and the metadata generator call this directly; client
 * components use `useMessages` from `@commise/i18n/react`. Pure.
 */
export function getDictionary(locale: Locale): WebMessages {
    return resolveMessages(webMessages, locale);
}
