/**
 * `renderDocument` fills the account and region placeholders of a policy table.
 *
 * It must do so by structure, never by splicing text into serialized JSON: a value that is not an account id or a
 * region must be refused, not carried into a document that IAM then reads.
 */
import { describe, expect, it } from 'vitest';

import { ACCOUNT, REGION, renderDocument, type PolicyDocument } from '../src/policyDocument.js';

const table: PolicyDocument = {
    Version: '2012-10-17',
    Statement: [
        {
            Sid: 'Own',
            Effect: 'Allow',
            Action: ['sqs:SendMessage'],
            Resource: [`arn:aws:sqs:${REGION}:${ACCOUNT}:kitchensink-*`, 'arn:aws:s3:::kitchensink-*'],
            Condition: { StringEquals: { 'aws:ResourceAccount': [ACCOUNT], 'aws:RequestedRegion': REGION } },
        },
        { Sid: 'Plain', Effect: 'Deny', Action: ['iam:CreateUser'], Resource: ['*'] },
    ],
};

describe('renderDocument', () => {
    it('fills the placeholders in resources and in condition values', () => {
        const rendered = renderDocument(table, { account: '123456789012', region: 'us-east-1' });

        expect(rendered.Statement[0]?.Resource).toEqual([
            'arn:aws:sqs:us-east-1:123456789012:kitchensink-*',
            'arn:aws:s3:::kitchensink-*',
        ]);
        expect(rendered.Statement[0]?.Condition).toEqual({
            StringEquals: { 'aws:ResourceAccount': ['123456789012'], 'aws:RequestedRegion': 'us-east-1' },
        });
        expect(rendered.Statement[1]).toEqual(table.Statement[1]);
    });

    it('leaves the table it was given untouched', () => {
        const before = JSON.stringify(table);

        renderDocument(table, { account: '123456789012', region: 'us-east-1' });

        expect(JSON.stringify(table)).toBe(before);
    });

    it('accepts the unresolved tokens a CDK stack passes for its own account and region', () => {
        const rendered = renderDocument(table, {
            account: '${Token[AWS.AccountId.4]}',
            region: '${Token[AWS.Region.7]}',
        });

        expect(rendered.Statement[0]?.Resource[0]).toBe(
            'arn:aws:sqs:${Token[AWS.Region.7]}:${Token[AWS.AccountId.4]}:kitchensink-*',
        );
    });

    it.each([
        ['an account carrying a quote', '1234"5678901', 'us-east-1'],
        ['an account that is not twelve digits', '12345', 'us-east-1'],
        ['an empty account', '', 'us-east-1'],
        ['an account that is a replacement pattern', '$&$&$&$&$&$&', 'us-east-1'],
        ['a region carrying a quote', '123456789012', 'us-east-1"'],
        ['a region that is not a region', '123456789012', 'everywhere'],
    ])('refuses %s', (_name, account, region) => {
        expect(() => renderDocument(table, { account, region })).toThrow(/renderDocument/u);
    });
});
