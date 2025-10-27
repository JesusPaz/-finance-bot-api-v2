import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class FinanceBotApiV2Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 Bucket para PDFs
    const documentsBucket = new s3.Bucket(this, 'FinancesDataBucket', {
      bucketName: 'finances-data-851725652296',
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // SQS Queue para procesar PDFs
    const processingQueue = new sqs.Queue(this, 'PdfProcessingQueue', {
      queueName: 'pdf-processing-queue',
      visibilityTimeout: cdk.Duration.minutes(15), // Tiempo para procesar
      retentionPeriod: cdk.Duration.days(7),
    });

    // DynamoDB Table para contraseñas de documentos
    const documentPasswordsTable = new dynamodb.Table(this, 'DocumentPasswordsTable', {
      tableName: 'document-passwords',
      partitionKey: {
        name: 'auth0UserId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'documentType', // 'default', 'credit-card', 'bank-statement', etc.
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Temporal: eliminar en testing
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED, // Encriptar contraseñas
    });

    // DynamoDB Table para tracking de uploads/documentos
    const documentUploadsTable = new dynamodb.Table(this, 'DocumentUploadsTable', {
      tableName: 'document-uploads',
      partitionKey: {
        name: 'auth0UserId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'documentId', // UUID único del documento
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Temporal: eliminar en testing
      pointInTimeRecovery: true,
    });

    // GSI para buscar documentos por estado
    documentUploadsTable.addGlobalSecondaryIndex({
      indexName: 'status-uploadedAt-index',
      partitionKey: {
        name: 'statusComposite', // auth0UserId#status (ej: "user123#PROCESSING")
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'uploadedAt',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // DynamoDB Table para transacciones
    const transactionsTable = new dynamodb.Table(this, 'TransactionsTable', {
      tableName: 'finance-transactions',
      partitionKey: {
        name: 'auth0UserId', // Cambiar a auth0UserId
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'transactionId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // On-demand pricing
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Temporal: eliminar en testing
      pointInTimeRecovery: true, // Backups automáticos
    });

    // GSI para buscar por fecha
    transactionsTable.addGlobalSecondaryIndex({
      indexName: 'auth0UserId-date-index',
      partitionKey: {
        name: 'auth0UserId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'date',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Lambda para generar presigned URL
    const presignLambda = new lambda.Function(this, 'PresignLambda', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'api/upload-url.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        BUCKET_NAME: documentsBucket.bucketName,
        PASSWORDS_TABLE_NAME: documentPasswordsTable.tableName,
        UPLOADS_TABLE_NAME: documentUploadsTable.tableName, // Add uploads tracking table
        LOG_LEVEL: 'INFO',
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'API: Genera presigned URLs para subir PDFs',
    });

    documentsBucket.grantPut(presignLambda);
    documentPasswordsTable.grantWriteData(presignLambda);
    documentUploadsTable.grantWriteData(presignLambda); // Grant write to uploads table

        // Worker Lambda que procesa PDFs desde SQS usando imagen Docker
        const workerLambda = new lambda.DockerImageFunction(this, 'PdfWorkerLambda', {
          code: lambda.DockerImageCode.fromImageAsset('.'),
          timeout: cdk.Duration.minutes(15),
          memorySize: 1024,
          environment: {
            BUCKET_NAME: documentsBucket.bucketName,
            TABLE_NAME: transactionsTable.tableName,
            PASSWORDS_TABLE_NAME: documentPasswordsTable.tableName,
            UPLOADS_TABLE_NAME: documentUploadsTable.tableName, // Add uploads tracking table
            LOG_LEVEL: 'INFO',
          },
          description: 'Worker: Procesa PDFs y extrae transacciones a DynamoDB',
        });

    // Permisos para el worker
    documentsBucket.grantRead(workerLambda);
    documentsBucket.grantWrite(workerLambda); // Para guardar PDFs desbloqueados
    transactionsTable.grantReadWriteData(workerLambda); // Acceso completo a DynamoDB
    documentPasswordsTable.grantReadData(workerLambda); // Grant read to passwords table
    documentUploadsTable.grantReadWriteData(workerLambda); // Grant read/write to uploads table
    
    // Conectar SQS con Worker Lambda
    workerLambda.addEventSource(new lambdaEventSources.SqsEventSource(processingQueue, {
      batchSize: 1, // Procesar un PDF a la vez
    }));
    
    // S3 notifica a SQS cuando se sube un PDF
    documentsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SqsDestination(processingQueue),
      { prefix: 'pdfs/' }
    );

    // Lambda Authorizer para Auth0
    const authorizerLambda = new lambda.Function(this, 'Auth0Authorizer', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'auth/authorizer.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        AUTH0_DOMAIN: process.env.AUTH0_DOMAIN || 'YOUR_AUTH0_DOMAIN', // ej: "tenant.us.auth0.com"
        AUTH0_AUDIENCE: process.env.AUTH0_AUDIENCE || 'YOUR_AUTH0_AUDIENCE', // ej: "https://api.financebot.com"
        LOG_LEVEL: 'INFO',
      },
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      description: 'Authorizer: Valida JWT de Auth0',
    });

    // API Gateway simple
    const api = new apigateway.RestApi(this, 'FinanceApi', {
      restApiName: 'Finance API Simple',
      description: 'API simple para subir PDFs y gestionar contraseñas',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'], // Importante: permitir Authorization header
      },
    });

    // Crear el authorizer
    const authorizer = new apigateway.TokenAuthorizer(this, 'Auth0TokenAuthorizer', {
      handler: authorizerLambda,
      identitySource: 'method.request.header.Authorization',
      resultsCacheTtl: cdk.Duration.minutes(5), // Cache de 5 minutos
    });

    // Lambda para GET /transactions
    const getTransactionsLambda = new lambda.Function(this, 'GetTransactionsLambda', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'api/get-transactions.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        TABLE_NAME: transactionsTable.tableName,
        LOG_LEVEL: 'INFO',
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'API: Obtiene transacciones de DynamoDB',
    });

    transactionsTable.grantReadData(getTransactionsLambda);

    // Lambda para GET /documents (listar documentos)
    const listDocumentsLambda = new lambda.Function(this, 'ListDocumentsLambda', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'api/list-documents.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        UPLOADS_TABLE_NAME: documentUploadsTable.tableName,
        LOG_LEVEL: 'INFO',
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'API: Lista documentos subidos por el usuario',
    });

    documentUploadsTable.grantReadData(listDocumentsLambda);

    // Lambda para GET /documents/{documentId} (detalle de documento)
    const getDocumentDetailLambda = new lambda.Function(this, 'GetDocumentDetailLambda', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'api/get-document-detail.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        UPLOADS_TABLE_NAME: documentUploadsTable.tableName,
        LOG_LEVEL: 'INFO',
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'API: Obtiene detalle de un documento específico',
    });

    documentUploadsTable.grantReadData(getDocumentDetailLambda);

    // Endpoint: POST /upload-url (PROTEGIDO)
    const uploadResource = api.root.addResource('upload-url');
    uploadResource.addMethod('POST', new apigateway.LambdaIntegration(presignLambda, {
      proxy: true,
    }), {
      authorizer: authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });

    // Endpoint: GET /transactions (PROTEGIDO)
    const transactionsResource = api.root.addResource('transactions');
    transactionsResource.addMethod('GET', new apigateway.LambdaIntegration(getTransactionsLambda), {
      authorizer: authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });

    // Endpoint: GET /documents (PROTEGIDO) - Listar documentos
    const documentsResource = api.root.addResource('documents');
    documentsResource.addMethod('GET', new apigateway.LambdaIntegration(listDocumentsLambda), {
      authorizer: authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      requestParameters: {
        'method.request.querystring.status': false,
        'method.request.querystring.limit': false,
        'method.request.querystring.cursor': false,
      },
    });

    // Endpoint: GET /documents/{documentId} (PROTEGIDO) - Detalle de documento
    const documentDetailResource = documentsResource.addResource('{documentId}');
    documentDetailResource.addMethod('GET', new apigateway.LambdaIntegration(getDocumentDetailLambda), {
      authorizer: authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'URL de la API',
      exportName: 'FinanceApiUrl',
    });

    new cdk.CfnOutput(this, 'BucketName', {
      value: documentsBucket.bucketName,
      description: 'Bucket S3',
      exportName: 'FinanceBucketName',
    });

    new cdk.CfnOutput(this, 'QueueUrl', {
      value: processingQueue.queueUrl,
      description: 'URL de la cola SQS',
      exportName: 'ProcessingQueueUrl',
    });

    new cdk.CfnOutput(this, 'WorkerLambda', {
      value: workerLambda.functionName,
      description: 'Nombre del worker Lambda',
      exportName: 'WorkerLambdaName',
    });

    new cdk.CfnOutput(this, 'TransactionsTableName', {
      value: transactionsTable.tableName,
      description: 'Nombre de la tabla DynamoDB',
      exportName: 'TransactionsTableName',
    });

    new cdk.CfnOutput(this, 'PasswordsTableName', {
      value: documentPasswordsTable.tableName,
      description: 'Nombre de la tabla de contraseñas',
      exportName: 'PasswordsTableName',
    });

    new cdk.CfnOutput(this, 'UploadsTableName', {
      value: documentUploadsTable.tableName,
      description: 'Nombre de la tabla de uploads/tracking',
      exportName: 'UploadsTableName',
    });
  }
}
