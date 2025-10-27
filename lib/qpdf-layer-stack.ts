import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export class QpdfLayerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Crear un layer de qpdf usando un binario pre-compilado
    const qpdfLayer = new lambda.LayerVersion(this, 'QpdfLayer', {
      code: lambda.Code.fromAsset('lambda-layer/qpdf-layer'),
      compatibleRuntimes: [lambda.Runtime.NODEJS_22_X],
      description: 'Layer que contiene qpdf para AWS Lambda',
      license: 'Apache-2.0',
    });

    // Output del ARN del layer
    new cdk.CfnOutput(this, 'QpdfLayerArn', {
      value: qpdfLayer.layerVersionArn,
      description: 'ARN del layer de qpdf',
    });
  }
}
