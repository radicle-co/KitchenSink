/**
 * @module nextLink — `next/link` for a static artboard: a plain anchor that keeps the whole href, including the
 * query and the hash of a UrlObject, and drops the props only the Next router understands.
 *
 * @pattern Adapter over next/link (typed against its props)
 */
import type { LinkProps } from 'next/link.js';
import { forwardRef, type AnchorHTMLAttributes } from 'react';

type NextHref = LinkProps['href'];
type QueryValue = string | number | boolean | readonly (string | number | boolean)[] | null | undefined;

function searchOf(query: unknown): string {
    if (typeof query === 'string') {
        return query === '' ? '' : `?${query.replace(/^\?/, '')}`;
    }

    if (typeof query !== 'object' || query === null) {
        return '';
    }

    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(query as Record<string, QueryValue>)) {
        for (const item of Array.isArray(value) ? value : [value]) {
            if (item !== undefined && item !== null) {
                params.append(key, String(item));
            }
        }
    }

    const text = params.toString();

    return text === '' ? '' : `?${text}`;
}

/**
 * The URL string for a Next href.
 *
 * @param href - A string, or a UrlObject.
 * @returns The string; `#` when the object names nothing.
 */
export function hrefString(href: NextHref): string {
    if (typeof href === 'string') {
        return href;
    }

    const search = href.search ? `?${href.search.replace(/^\?/, '')}` : searchOf(href.query);
    const hash = href.hash ? `#${href.hash.replace(/^#/, '')}` : '';

    return `${href.pathname ?? ''}${search}${hash}` || '#';
}

type Props = Omit<LinkProps, keyof AnchorHTMLAttributes<HTMLAnchorElement>> &
    Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & { readonly href: NextHref };

/** An anchor standing in for the Next link. */
const Link = forwardRef<HTMLAnchorElement, Props>(function Link(props, ref) {
    const {
        href,
        as: _as,
        replace: _replace,
        scroll: _scroll,
        shallow: _shallow,
        passHref: _passHref,
        prefetch: _prefetch,
        locale: _locale,
        legacyBehavior: _legacyBehavior,
        onNavigate: _onNavigate,
        ...anchor
    } = props as Props & Record<string, unknown>;

    return <a {...(anchor as AnchorHTMLAttributes<HTMLAnchorElement>)} ref={ref} href={hrefString(href)} />;
});

export default Link;
