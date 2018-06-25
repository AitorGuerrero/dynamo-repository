import {DynamoDB} from "aws-sdk";

export interface ISearchInput {
	IndexName?: DynamoDB.DocumentClient.IndexName;
	Select?: DynamoDB.DocumentClient.Select;
	Limit?: DynamoDB.DocumentClient.PositiveIntegerObject;
	ScanIndexForward?: DynamoDB.DocumentClient.BooleanObject;
	ExclusiveStartKey?: DynamoDB.DocumentClient.Key;
	FilterExpression?: DynamoDB.DocumentClient.ConditionExpression;
	KeyConditionExpression?: DynamoDB.DocumentClient.KeyExpression;
	ExpressionAttributeNames?: DynamoDB.DocumentClient.ExpressionAttributeNameMap;
	ExpressionAttributeValues?: DynamoDB.DocumentClient.ExpressionAttributeValueMap;
}
