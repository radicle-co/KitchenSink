import { Module, Global, Provider } from '@nestjs/common';
import { SQSClient } from '@aws-sdk/client-sqs';

import { SqsService, SQS_CLIENT } from './sqs.service.js';

const sqsClientProvider: Provider = {
    provide: SQS_CLIENT,
    useFactory() {
        return new SQSClient({ region: process.env['DEFAULT_AWS_REGION'] ?? 'us-east-1' });
    },
};

@Global()
@Module({
    providers: [sqsClientProvider, SqsService],
    exports: [SQS_CLIENT, SqsService],
})
export class QueueModule {}
