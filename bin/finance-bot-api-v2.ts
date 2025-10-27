#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { FinanceBotApiV2Stack } from '../lib/finance-bot-api-v2-stack';

// Declarar process para TypeScript
declare const process: any;

const app = new cdk.App();

// Configurar el perfil AWS
process.env.AWS_PROFILE = 'personal';

new FinanceBotApiV2Stack(app, 'FinanceBotApiV2Stack', {
  /* If you don't specify 'env', this stack will be environment-agnostic.
   * Account/Region-dependent features and context lookups will not work,
   * but a single synthesized template can be deployed anywhere. */

  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

  /* Uncomment the next line if you know exactly what Account and Region you
   * want to deploy the stack to. */
  env: { account: '851725652296', region: 'us-east-2' },

  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
});