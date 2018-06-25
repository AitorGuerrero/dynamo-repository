import {DynamoDB} from "aws-sdk";

export interface ICountInput {
	IndexName?: DynamoDB.DocumentClient.IndexName;
	FilterExpression?: DynamoDB.DocumentClient.ConditionExpression;
	KeyConditionExpression?: DynamoDB.DocumentClient.KeyExpression;
	ExpressionAttributeNames?: DynamoDB.DocumentClient.ExpressionAttributeNameMap;
	ExpressionAttributeValues?: DynamoDB.DocumentClient.ExpressionAttributeValueMap;
	ExclusiveStartKey?: DynamoDB.DocumentClient.Key;
}
