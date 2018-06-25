import {DynamoDB} from "aws-sdk";

interface IGlobalSecondaryIndex {
	ProjectionType: "KEYS_ONLY" | "INCLUDE" | "ALL";
}

export interface ITableConfig<Entity> {
	tableName: string;
	keySchema: DynamoDB.DocumentClient.KeySchema;
	secondaryIndexes?: {[indexName: string]: IGlobalSecondaryIndex};
	marshal?: (e: Entity) => DynamoDB.DocumentClient.AttributeMap;
	unMarshal?: (item: DynamoDB.DocumentClient.AttributeMap) => Entity;
}