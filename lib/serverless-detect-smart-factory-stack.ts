import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cdk from 'aws-cdk-lib';
import * as path from 'path';
import * as cfn from 'aws-cdk-lib/aws-cloudformation';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as fs from 'fs';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as s3_deployment from 'aws-cdk-lib/aws-s3-deployment';
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { Pass } from '@aws-cdk/aws-stepfunctions';
import { StateMachine } from 'aws-cdk-lib/aws-stepfunctions';
import * as rekognition from "aws-cdk-lib/aws-rekognition";
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { KinesisFirehoseStream } from 'aws-cdk-lib/aws-events-targets';
import { CfnDeliveryStream } from 'aws-cdk-lib/aws-kinesisfirehose';

export class ServerlessDetectSmartFactoryStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    //lambda hanlders definiton
    const classifyDefectsLambda = new lambda.Function(this, 'classifyLambda', {
      code: new lambda.InlineCode(fs.readFileSync('lambda/DetectAnomaliesFunction/classifyDefects.py', { encoding: 'utf-8' })),
      handler: 'index.lambda_handler',
      timeout: cdk.Duration.seconds(30),
      runtime: lambda.Runtime.PYTHON_3_9,
    });

    classifyDefectsLambda.addToRolePolicy(    
      new iam.PolicyStatement({
      actions: ["rekognition:*"],
      resources: ["*"]
    }));

    const detectAnomaliesLambda = new lambda.Function(this, 'DetectLambda', {
      code: new lambda.InlineCode(fs.readFileSync('lambda/DetectAnomaliesFunction/startDetectAnomalies.py', { encoding: 'utf-8' })),
      handler: 'index.lambda_handler',
      timeout: cdk.Duration.seconds(30),
      runtime: lambda.Runtime.PYTHON_3_9,
      environment: {

      }
    });

    detectAnomaliesLambda.addToRolePolicy(    
      new iam.PolicyStatement({
      actions: ["lookoutvision:*"],
      resources: ["*"]
    }));

    //DynamoDB creation
    const resultTable = new dynamodb.Table(this, 'DetectResult', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING }, 
      stream: dynamodb.StreamViewType.NEW_IMAGE
    });

    //DB to S3
    const resultBucket = new s3.Bucket(this, "resultBucket");
     //firehose
     const firehoseRole = new iam.Role(this, 'firehoseRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com')
    });

    const firehose = new CfnDeliveryStream(this, "firehoseStreamToS3", {
      deliveryStreamName: "firehose-delivery-stream",
      deliveryStreamType: "DirectPut",
      s3DestinationConfiguration: {
        bucketArn: resultBucket.bucketArn,
        compressionFormat: 'UNCOMPRESSED',
        encryptionConfiguration: {
          noEncryptionConfig: "NoEncryption"
        },
        prefix: "user-logs",
        errorOutputPrefix: 'user-error-logs',
        roleArn: firehoseRole.roleArn
    }});

    const DynamoToFirehoseLambda = new lambda.Function(this, 'DynamoToFirehoseLambda', {
      code: new lambda.InlineCode(fs.readFileSync('lambda/DynamoDbToFirehose/lambda_function.py', { encoding: 'utf-8' })),
      handler: 'index.lambda_handler',
      timeout: cdk.Duration.seconds(30),
      runtime: lambda.Runtime.PYTHON_3_9,
      environment: {
        FirehoseName: "firehose-delivery-stream"
      }
    });

    resultTable.grantReadWriteData(DynamoToFirehoseLambda);
    resultBucket.grantWrite(firehoseRole);
    resultBucket.grantPut(firehoseRole);
    resultBucket.grantPut(DynamoToFirehoseLambda);
    resultBucket.grantReadWrite(DynamoToFirehoseLambda);

    DynamoToFirehoseLambda.addToRolePolicy(    
      new iam.PolicyStatement({
      actions: ["dynamodb:*"],
      resources: ["*"]
    }));

    DynamoToFirehoseLambda.addToRolePolicy(    
      new iam.PolicyStatement({
      actions: ["firehose:*"],
      resources: ["*"]
    }));

    DynamoToFirehoseLambda.addEventSource(new DynamoEventSource(resultTable, {
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
    }));

   

    const putResultInDBLambda = new lambda.Function(this, 'putDBLambda', {
      code: new lambda.InlineCode(fs.readFileSync('lambda/DetectAnomaliesFunction/putItemInDynamoDb.py', { encoding: 'utf-8' })),
      handler: 'index.lambda_handler',
      timeout: cdk.Duration.seconds(30),
      runtime: lambda.Runtime.PYTHON_3_9,
      environment: {
        DYNAMODB_TABLE_NAME: resultTable.tableName,
      }
    });

    putResultInDBLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:*"],
      resources: ["*"]
    }));
   

    //step function definition
    const DetectAnomalies = new tasks.LambdaInvoke(this, 'detectAnomaliesLambda', { lambdaFunction: detectAnomaliesLambda, outputPath: '$.Payload' });
    const classifyDefects = new tasks.LambdaInvoke(this, 'ClassifyDefects', { lambdaFunction: classifyDefectsLambda, outputPath: '$.Payload' });
    const putResult = new tasks.LambdaInvoke(this, 'putResult', { lambdaFunction: putResultInDBLambda, outputPath: '$.Payload' });


    const jobFailed = new sfn.Fail(this, 'Job Failed', {
      cause: 'AWS Batch Job Failed',
      error: 'DescribeJob returned FAILED',
    });

    //create chain
    const choice = new sfn.Choice(this,'IsAnomaly?');
    const skip = new sfn.Pass(this, 'pass');
    choice.when(sfn.Condition.booleanEquals('$.DetectAnomalyResult.IsAnomalous',true), classifyDefects);
    choice.when(sfn.Condition.booleanEquals('$.DetectAnomalyResult.IsAnomalous',false), skip);
    choice.afterwards().next(putResult);
    const definition = DetectAnomalies.next(choice);


    //create state machine
    const stateMachine = new sfn.StateMachine(this, 'stateMachine', {definition, timeout: cdk.Duration.minutes(5)});

    //lambda execution
    
    classifyDefectsLambda.grantInvoke(stateMachine.role);
    detectAnomaliesLambda.grantInvoke(stateMachine.role);
    putResultInDBLambda.grantInvoke(stateMachine.role);

    const startStateMachineLambda = new lambda.Function(this, 'startLambda', {
      code: new lambda.InlineCode(fs.readFileSync('lambda/DetectAnomaliesFunction/startStateMachineExecution.py', { encoding: 'utf-8' })),
      handler: 'index.lambda_handler',
      timeout: cdk.Duration.seconds(30),
      runtime: lambda.Runtime.PYTHON_3_9,
      environment: {
        STATE_MACHINE_ARN : stateMachine.stateMachineArn
      }
    });

    stateMachine.grantStartExecution(startStateMachineLambda);

    //start bucket
    const bucket = new s3.Bucket(this, "imageBucket");
    bucket.grantReadWrite(startStateMachineLambda);
    bucket.grantReadWrite(classifyDefectsLambda);
    bucket.grantReadWrite(detectAnomaliesLambda);
 
    
    //trigger startStateMachine lambda on create object
    bucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(startStateMachineLambda));

  }}