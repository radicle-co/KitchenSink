/**
 * The alarm-subscription rule (R3.2, plan U11).
 *
 * Both branches matter and both have already failed in this repository: without the subscription an alarm
 * publishes to a topic nobody listens to (every service topic shipped that way), and without the
 * absent-address tolerance a synth fails in any account that has not configured a recipient — which is
 * every fork and every local `cdk synth`.
 */
import { App, Stack, aws_sns as sns } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect } from 'vitest';

import { subscribeAlarmEmail } from '../alarmSubscription.js';

function withEmail(email: string | undefined): { template: Template; added: boolean } {
    const stack = new Stack(new App(), 'S', { env: { account: '123456789012', region: 'us-east-1' } });
    const topic = new sns.Topic(stack, 'AlarmTopic', { enforceSSL: true });
    const added = subscribeAlarmEmail(topic, email);

    return { template: Template.fromStack(stack), added };
}

describe('subscribeAlarmEmail', () => {
    it('subscribes the configured address so an alarm reaches a human', () => {
        const { template, added } = withEmail('ops@example.com');

        expect(added).toBe(true);
        template.hasResourceProperties('AWS::SNS::Subscription', {
            Protocol: 'email',
            Endpoint: 'ops@example.com',
        });
    });

    it('degrades gracefully when no address is configured', () => {
        const { template, added } = withEmail(undefined);

        expect(added).toBe(false);
        template.resourceCountIs('AWS::SNS::Subscription', 0);
    });

    it('⛔ treats an EMPTY string as absent — an unset CI variable expands to one', () => {
        // `new EmailSubscription('')` synthesizes a subscription that can never be confirmed, which looks
        // configured in the template and notifies nobody. That is worse than no subscription, because it
        // passes a "has a subscription" check.
        expect(withEmail('').added).toBe(false);
        expect(withEmail('   ').added).toBe(false);
        withEmail('').template.resourceCountIs('AWS::SNS::Subscription', 0);
    });

    it('trims a padded address rather than subscribing whitespace', () => {
        withEmail('  ops@example.com  ').template.hasResourceProperties('AWS::SNS::Subscription', {
            Endpoint: 'ops@example.com',
        });
    });
});
