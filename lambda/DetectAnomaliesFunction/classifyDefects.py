import boto3
from decimal import Decimal
import json
import urllib.request
import urllib.parse
import urllib.error

# Environment Variables
PROJECT_NAME = os.environ['PROJECT_NAME']
MODEL_VERSION = os.environ['MODEL_VERSION']
REGION = os.environ.get('REGION', 'us-east-1')
# Initiate clients
rekognition = boto3.client('rekognition')
s3 = boto3.client('s3')

print('Loading function')

# --------------- Main handler ------------------

def lambda_handler(event, context):

    # Get the object from the event
    bucket = event['Input']['Bucket']
    key = event['Input']['Key']
    try:
        # Calls rekognition DetectLabels API to detect labels in S3 object
        response = detect_labels(bucket, key)
        return response

    except Exception as e:

        print(e)
        raise e



# response = client.detect_labels(
#     Image={
#         'Bytes': b'bytes',
#         'S3Object': {
#             'Bucket': 'string',
#             'Name': 'string',
#             'Version': 'string'
#         }
#     },
#     MaxLabels=123,
#     MinConfidence=...
# )


# {
#     'Labels': [
#         {
#             'Name': 'string', -> is anomalous
#             'Confidence': ..., -> Confidence
#             'Instances': [
#                 {
#                     'BoundingBox': {
#                         'Width': ...,
#                         'Height': ...,
#                         'Left': ...,
#                         'Top': ...
#                     },
#                     'Confidence': ...
#                 },
#             ],
#             'Parents': [
#                 {
#                     'Name': 'string'
#                 },
#             ]
#         },
#     ],
#     'OrientationCorrection': 'ROTATE_0'|'ROTATE_90'|'ROTATE_180'|'ROTATE_270',
#     'LabelModelVersion': 'string'
# }


# --------------- Helper Functions to call Rekognition APIs ------------------

def detect_labels(bucket, key):


    try:
        response = s3.get_object(Bucket=bucket, Key=key)

        project_name = LFV_PROJECT_NAME
        model_version = LFV_MODEL_VERSION
        content_type = response['ContentType']
        image = response['Body']
        image_body = image.read()

        camera_id = response['Metadata']['cameraid']
        assembly_line_id = response['Metadata']['assemblylineid']
        image_id = response['Metadata']['imageid']
        
        rekog_response = rekognition.detect_labels(Image={"S3Object": {"Bucket": bucket, "Name": key}})
       
        toDb_response = {}
        toDb_response['CameraId'] = camera_id
        toDb_response['AssemblyLineId'] = assembly_line_id
        toDb_response['ImageId'] = image_id
        toDb_response['ImageUrl'] = 's3://'+bucket+'/'+key
        toDb_response['DetectAnomalyResult']['IsAnomalous'] = rekog_response['Labels']['Name']
        toDb_response['DetectAnomalyResult']['Confidence'] = rekog_response['Labels']['Confidence']

        print(json.dumps(toDb_response))

        return toDb_response

    except Exception as e:

        print(e)
        raise e


