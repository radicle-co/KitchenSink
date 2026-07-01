/**
 * ADR-0007 per-stage RDS right-sizing: prod keeps db.t4g.small (unchanged → no prod diff), every
 * non-prod stage runs db.t4g.micro. The instance class is the only stage-dependent RDS property.
 */
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect } from 'vitest';

import { DataStack } from '../lib/platform/data-stack.js';
import { NetworkStack } from '../lib/platform/network-stack.js';

const env = { account: '123456789012', region: 'us-east-1' };

const dataTemplate = (stage: string): Template => {
    const app = new App();
    const network = new NetworkStack(app, `Net-${stage}`, { env, stage });
    const data = new DataStack(app, `Data-${stage}`, { env, network, stage });

    return Template.fromStack(data);
};

describe('DataStack per-stage RDS instance class (ADR-0007)', () => {
    it('prod stays on db.t4g.small (unchanged sizing → no prod diff)', () => {
        dataTemplate('prod').hasResourceProperties('AWS::RDS::DBInstance', {
            DBInstanceClass: 'db.t4g.small',
        });
    });

    it('sandbox is right-sized down to db.t4g.micro', () => {
        dataTemplate('sandbox').hasResourceProperties('AWS::RDS::DBInstance', {
            DBInstanceClass: 'db.t4g.micro',
        });
    });

    it('an unspecified/dev stage also uses the smaller db.t4g.micro', () => {
        dataTemplate('dev').hasResourceProperties('AWS::RDS::DBInstance', {
            DBInstanceClass: 'db.t4g.micro',
        });
    });

    it('does not downsize prod when sandbox does (independent per-stage synths)', () => {
        const prodClasses = Object.values(dataTemplate('prod').findResources('AWS::RDS::DBInstance')).map(
            (resource: any) => resource.Properties.DBInstanceClass,
        );

        expect(prodClasses).toEqual(['db.t4g.small']);
    });
});
