import boto3
from decimal import Decimal
import json
import urllib.request
import urllib.parse
import urllib.error

# Initiate clients
rekognition = boto3.client('rekognition')
s3 = boto3.client('s3')
PROJECT_ARN = os.environ['PROJECT_ARN']

print('Loading function')

# --------------- Main handler ------------------

def lambda_handler(event, context):

    # Get the object from the event
    bucket = event['Bucket']
    key = event['Key']
    try:
        # Calls rekognition DetectLabels API to detect labels in S3 object
        response = detect_labels(bucket, key)
        return response

    except Exception as e:

        print(e)
        raise e

# --------------- Helper Functions to call Rekognition APIs ------------------

def detect_labels(bucket, key):

    try:
        response = s3.get_object(Bucket=bucket, Key=key)

        content_type = response['ContentType']
        image = response['Body']
        image_body = image.read()
        
        rekog_response = rekognition.detect_custom_labels(
            ProjectVersionArn = PROJECT_ARN,
            Image={"S3Object": {"Bucket": bucket, "Name": key}})
   
        toDb_response = {}

        toDb_response['Bucket'] = bucket
        toDb_response["Key"] = key
        toDb_response['ImageUrl'] = 's3://'+bucket+'/'+key
        toDb_response['DetectAnomalyResult'] = {'IsAnomalous':rekog_response['CustomLabels'][0]['Name'], 'Confidence' : rekog_response['CustomLabels'][0]['Confidence']}


        print(json.dumps(toDb_response))

        return toDb_response

    except Exception as e:

        print(e)
        raise e