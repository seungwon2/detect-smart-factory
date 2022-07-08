#  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
#  SPDX-License-Identifier: MIT-0
 
#  Permission is hereby granted, free of charge, to any person obtaining a copy of this
#  software and associated documentation files (the "Software"), to deal in the Software
#  without restriction, including without limitation the rights to use, copy, modify,
#  merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
#  permit persons to whom the Software is furnished to do so.
 
#  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
#  INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
#  PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
#  HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
#  OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
#  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

import boto3
import json
import os
import urllib.request
import datetime
from decimal import Decimal

DYNAMODB_TABLE_NAME = os.environ['DYNAMODB_TABLE_NAME']
REGION = os.environ['REGION']

# Initiate clients
dynamodb = boto3.resource('dynamodb', region_name=REGION)

def lambda_handler(event, context):

    payload = event
    timestamp = datetime.datetime.now().isoformat()

    table = dynamodb.Table(DYNAMODB_TABLE_NAME)

    item = {}
    
    item['DateTime'] = timestamp
    item['id'] = payload['ImageUrl']
    item['IsAnomalous'] = str(payload['DetectAnomalyResult']['IsAnomalous'])
    item['Confidence'] = Decimal(payload['DetectAnomalyResult']['Confidence'])

    try:
        # write the record to the database
        response = table.put_item(Item=item)
        return response

    except Exception as e:
        print(e)
        raise e
