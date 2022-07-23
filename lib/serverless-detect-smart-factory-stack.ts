import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { CfnDeliveryStream } from 'aws-cdk-lib/aws-kinesisfirehose';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cdk from 'aws-cdk-lib';
import * as fs from 'fs';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';

export class ServerlessDetectSmartFactoryStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    //env injection
    const rekogARN = this.node.tryGetContext('rekogARN');
    const l4vNAME = this.node.tryGetContext('l4vNAME');
    const l4vVER = this.node.tryGetContext('l4vVER');

    //DynamoDB creation
    const resultTable = new dynamodb.Table(this, 'DetectResult', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING }, 
      stream: dynamodb.StreamViewType.NEW_IMAGE
    });

    //start S3 bucket
    const startBucket = new s3.Bucket(this, "imageBucket");

    //result storing S3 bucket
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

    //lambda definition
    // 1. Lambda for Lookout for Vision
    const detectAnomaliesLambda = new lambda.Function(this, 'DetectLambda', {
      code: new lambda.InlineCode(fs.readFileSync('lambda/DetectAnomaliesFunction/startDetectAnomalies.py', { encoding: 'utf-8' })),
      handler: 'index.lambda_handler',
      timeout: cdk.Duration.seconds(30),
      runtime: lambda.Runtime.PYTHON_3_9,
      environment: {
        PROJECT_NAME: l4vNAME,
        MODEL_VERSION: l4vVER
      }
    });
    
    // 2. Lambda for Rekognition
    const classifyDefectsLambda = new lambda.Function(this, 'classifyLambda', {
      code: new lambda.InlineCode(fs.readFileSync('lambda/DetectAnomaliesFunction/classifyDefects.py', { encoding: 'utf-8' })),
      handler: 'index.lambda_handler',
      timeout: cdk.Duration.seconds(30),
      runtime: lambda.Runtime.PYTHON_3_9,
      environment: {
        PROJECT_ARN: rekogARN
      }
    });

    // 3. Lambda for storing result
    const putResultInDBLambda = new lambda.Function(this, 'putDBLambda', {
      code: new lambda.InlineCode(fs.readFileSync('lambda/DetectAnomaliesFunction/putItemInDynamoDb.py', { encoding: 'utf-8' })),
      handler: 'index.lambda_handler',
      timeout: cdk.Duration.seconds(30),
      runtime: lambda.Runtime.PYTHON_3_9,
      environment: {
        DYNAMODB_TABLE_NAME: resultTable.tableName,
        REGION: resultTable.env.region
      }
    });

    // 4. Lambda for DB to firehose data delivery
    const DynamoToFirehoseLambda = new lambda.Function(this, 'DynamoToFirehoseLambda', {
      code: new lambda.InlineCode(fs.readFileSync('lambda/DynamoDbToFirehose/lambda_function.py', { encoding: 'utf-8' })),
      handler: 'index.lambda_handler',
      timeout: cdk.Duration.seconds(30),
      runtime: lambda.Runtime.PYTHON_3_9,
      environment: {
        FirehoseName: "firehose-delivery-stream"
      }
    });

    //step function definition
    const DetectAnomalies = new tasks.LambdaInvoke(this, 'detectAnomaliesLambda', { lambdaFunction: detectAnomaliesLambda, outputPath: '$.Payload' });
    const classifyDefects = new tasks.LambdaInvoke(this, 'ClassifyDefects', { lambdaFunction: classifyDefectsLambda, outputPath: '$.Payload' });
    const putResult = new tasks.LambdaInvoke(this, 'putResult', { lambdaFunction: putResultInDBLambda, outputPath: '$.Payload' });

    //create chain
    const choice = new sfn.Choice(this,'IsAnomaly?');
    const skip = new sfn.Pass(this, 'pass');
    choice.when(sfn.Condition.booleanEquals('$.DetectAnomalyResult.IsAnomalous',true), classifyDefects);
    choice.when(sfn.Condition.booleanEquals('$.DetectAnomalyResult.IsAnomalous',false), skip);
    choice.afterwards().next(putResult);
    const definition = DetectAnomalies.next(choice);

    //create state machine
    const stateMachine = new sfn.StateMachine(this, 'stateMachine', {definition, timeout: cdk.Duration.minutes(5)});

    const startStateMachineLambda = new lambda.Function(this, 'startLambda', {
      code: new lambda.InlineCode(fs.readFileSync('lambda/DetectAnomaliesFunction/startStateMachineExecution.py', { encoding: 'utf-8' })),
      handler: 'index.lambda_handler',
      timeout: cdk.Duration.seconds(30),
      runtime: lambda.Runtime.PYTHON_3_9,
      environment: {
        STATE_MACHINE_ARN : stateMachine.stateMachineArn
      }
    });

    //lambda service execution role
    detectAnomaliesLambda.addToRolePolicy(    
      new iam.PolicyStatement({
      actions: ["lookoutvision:*"],
      resources: ["*"]
    }));

    classifyDefectsLambda.addToRolePolicy(    
      new iam.PolicyStatement({
      actions: ["rekognition:*"],
      resources: ["*"]
    }));

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

    putResultInDBLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:*"],
      resources: ["*"]
    }));
   
    //lambda state machine execution role
    classifyDefectsLambda.grantInvoke(stateMachine.role);
    detectAnomaliesLambda.grantInvoke(stateMachine.role);
    putResultInDBLambda.grantInvoke(stateMachine.role);
    stateMachine.grantStartExecution(startStateMachineLambda);
    
    //lambda bucket & DB execution role
    resultTable.grantReadWriteData(DynamoToFirehoseLambda);
    startBucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(startStateMachineLambda));
    startBucket.grantReadWrite(startStateMachineLambda);
    startBucket.grantReadWrite(classifyDefectsLambda);
    startBucket.grantReadWrite(detectAnomaliesLambda);
    resultBucket.grantWrite(firehoseRole);
    resultBucket.grantPut(firehoseRole);
    resultBucket.grantPut(DynamoToFirehoseLambda);
    resultBucket.grantReadWrite(DynamoToFirehoseLambda);

  }}