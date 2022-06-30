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
import * as s3_deployment from 'aws-cdk-lib/aws-s3-deployment';
import { SfnStateMachine } from 'aws-cdk-lib/aws-events-targets';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';

export class StepfunctionTest extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    //lambda hanlders definiton

    const startStateMachineLambda = new lambda.Function(this, 'startLambda', {
      code: new lambda.InlineCode(fs.readFileSync('../lambda/DetectAnomaliesFunction/startStateMachineExecution.py', { encoding: 'utf-8' })),
      handler: 'index.lambda_handler',
      timeout: cdk.Duration.seconds(30),
      runtime: lambda.Runtime.PYTHON_3_9,
    });

    const classifyDefectsLambda = new lambda.Function(this, 'classifyLambda', {
      code: new lambda.InlineCode(fs.readFileSync('../lambda/DetectAnomaliesFunction/classifyDefects.py', { encoding: 'utf-8' })),
      handler: 'index.lambda_handler',
      timeout: cdk.Duration.seconds(30),
      runtime: lambda.Runtime.PYTHON_3_9,
    });

    const detectAnomaliesLambda = new lambda.Function(this, 'DetectLambda', {
      code: new lambda.InlineCode(fs.readFileSync('../lambda/DetectAnomaliesFunction/startDetectAnomalies.py', { encoding: 'utf-8' })),
      handler: 'index.lambda_handler',
      timeout: cdk.Duration.seconds(30),
      runtime: lambda.Runtime.PYTHON_3_9,
    });

    const putResultInDBLambda = new lambda.Function(this, 'putDBLambda', {
      code: new lambda.InlineCode(fs.readFileSync('../lambda/DetectAnomaliesFunction/putItemInDynamoDb.py', { encoding: 'utf-8' })),
      handler: 'index.lambda_handler',
      timeout: cdk.Duration.seconds(30),
      runtime: lambda.Runtime.PYTHON_3_9,
    });
    //step function definition

    const DetectAnomalies = new tasks.LambdaInvoke(this, 'detectAnomaliesLambda', { lambdaFunction: detectAnomaliesLambda, outputPath: '$.Payload' });
    const classifyDefects = new tasks.LambdaInvoke(this, 'ClassifyDefects', { lambdaFunction: classifyDefectsLambda, outputPath: '$.Payload' });
    const putResult = new tasks.LambdaInvoke(this, 'putResult', { lambdaFunction: putResultInDBLambda, outputPath: '$.Payload' });


    const jobFailed = new sfn.Fail(this, 'Job Failed', {
      cause: 'AWS Batch Job Failed',
      error: 'DescribeJob returned FAILED',
    });

    //create chain
    const definition = classifyDefects.next(new sfn.Choice(this, 'Is Anomaly?')
    .when(sfn.Condition.booleanEquals('$.Payload.DetectAnomalyResult.IsAnomalous',true), DetectAnomalies))
    .next(putResult);

    //create state machine
    const stateMachine = new sfn.StateMachine(this, 'stateMachine', {definition, timeout: cdk.Duration.minutes(5)});

    //lambda execution
    classifyDefectsLambda.grantInvoke(stateMachine.role);
    detectAnomaliesLambda.grantInvoke(stateMachine.role);
    putResultInDBLambda.grantInvoke(stateMachine.role);

  }
}
