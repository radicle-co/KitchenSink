/**
 * @module @commise/ui/state-notice — the web `StateNotice`: an alert that says what went wrong, in the page's flow, with
 * up to two ways out. The title is the page's heading (the failed view had one), the actions are the design system's
 * buttons — a retry is a quiet `Button` whose description is the body, a way back is a real link when it has an `href` — and nothing in it is an unstyled
 * control.
 *
 * Presentational: props → JSX.
 *
 * @pattern Template — one alert layout; the link-or-button choice is `RouteAction`'s Strategy, not this component's
 */
import type { FC } from 'react';

import { Button } from '../button/Button.js';
import { buttonGlyphClass, buttonSurfaceClass } from '../button/surfaceClass.js';
import { Icon } from '../icon/Icon.js';
import { RouteAction } from '../routeLink/RouteAction.js';
import type { StateNoticeAction, StateNoticeProps } from './props.js';

/** Props for {@link NoticeAction}. */
interface NoticeActionProps {
    readonly action: StateNoticeAction;
    /** `quiet` for the action the cook most likely wants (Try again), `ghost` for the way out. */
    readonly variant: 'quiet' | 'ghost';
    /** Why the notice is shown, as the action's accessible description. Omitted for the way out. */
    readonly description?: string;
}

/** One way out: a link when it has an `href`, a button when it has none. */
const NoticeAction: FC<NoticeActionProps> = ({ action, variant, description }) => {
    if (action.href === undefined) {
        const { label, icon, onPress } = action;

        return variant === 'ghost' ? (
            <Button variant="ghost" icon={icon} onPress={onPress}>
                {label}
            </Button>
        ) : (
            <Button
                variant="quiet"
                icon={icon}
                onPress={onPress}
                {...(description === undefined ? {} : { description })}
            >
                {label}
            </Button>
        );
    }

    return (
        <RouteAction href={action.href} onPress={action.onPress} className={buttonSurfaceClass(variant)}>
            <span
                aria-hidden="true"
                className={`inline-flex shrink-0 items-center ${buttonGlyphClass(variant)}`.trimEnd()}
            >
                <Icon name={action.icon} size={variant === 'ghost' ? 16 : 20} />
            </span>
            {action.label}
        </RouteAction>
    );
};

/** The web state notice: presentational, props → JSX. */
export const StateNotice: FC<StateNoticeProps> = ({ title, body, primary, secondary }) => (
    <div role="alert" className="flex max-w-reading flex-col items-start gap-4 py-8">
        <h1 className="text-section-title text-ink">{title}</h1>
        {body === undefined ? null : <p className="text-body-sm text-ink-muted">{body}</p>}
        {primary === undefined && secondary === undefined ? null : (
            <div className="flex flex-wrap items-center gap-2">
                {primary === undefined ? null : (
                    <NoticeAction
                        action={primary}
                        variant="quiet"
                        {...(body === undefined ? {} : { description: body })}
                    />
                )}
                {secondary === undefined ? null : <NoticeAction action={secondary} variant="ghost" />}
            </div>
        )}
    </div>
);
