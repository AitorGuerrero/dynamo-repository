import {DynamoDB} from "aws-sdk";
import generatorToArray from "./generator-to-array";
import getEntityKey from "./get-entity-key";
import {EventEmitter} from "events";
import {ITableConfig} from "./table-config.interface";
import {ISearchInput} from "./search-input.interface";
import {ICountInput} from "./count-input.interface";

import DocumentClient = DynamoDB.DocumentClient;
import {IGenerator} from "./generator.interface";

const hash = "HASH";
const range = "RANGE";

export class DynamoRepository<Entity> {

	private static isQueryInput(input: any): input is DocumentClient.QueryInput {
		return input.KeyConditionExpression !== undefined;
	}

	public readonly eventEmitter: EventEmitter;

	protected readonly config: ITableConfig<Entity>;
	private readonly _hashKey: string;
	private readonly _rangeKey: string;

	constructor(
		protected dc: DocumentClient,
		config: ITableConfig<Entity>,
		eventEmitter?: EventEmitter,
	) {
		this.config = Object.assign({
			marshal: (e: Entity) => JSON.parse(JSON.stringify(e)) as DocumentClient.AttributeMap,
			unMarshal: (e: DocumentClient.AttributeMap) => JSON.parse(JSON.stringify(e)) as Entity,
		}, config);
		this._hashKey = config.keySchema.find((k) => k.KeyType === hash).AttributeName;
		const rangeSchema = config.keySchema.find((k) => k.KeyType === range);
		if (rangeSchema) {
			this._rangeKey = rangeSchema.AttributeName;
		}
		this.eventEmitter = eventEmitter || new EventEmitter();
	}

	public async get(Key: DocumentClient.Key) {
		const input: DocumentClient.GetItemInput = {
			Key,
			TableName: this.config.tableName,
		};
		const response = await this.asyncGet(input);

		return response.Item === undefined ? undefined : this.config.unMarshal(response.Item);
	}

	public async getList(keys: DocumentClient.Key[]) {
		const input: DocumentClient.BatchGetItemInput = {
			RequestItems: {
				[this.config.tableName]: {Keys: uniqueKeys(keys)},
			},
		};
		const response = await new Promise<DocumentClient.BatchGetItemOutput>(
			(rs, rj) => this.dc.batchGet(input, (err, res) => err ? rj(err) : rs(res)),
		);
		const result = new Map<DocumentClient.Key, Entity>();
		for (const item of response.Responses[this.config.tableName]) {
			const entity = this.config.unMarshal(item);
			result.set(keys.find((k) => sameKey(
				k,
				getEntityKey(this.config.keySchema, this.config.marshal(entity)),
			)), entity);
		}

		return result;
	}

	public search(input: ISearchInput) {
		const getNextBlock = this.buildScanBlockGenerator(input);

		let batch: any[] = [];
		let sourceIsEmpty = false;

		const generator = (async () => {
			while (batch.length === 0 && sourceIsEmpty === false) {
				const dynamoResponse = await getNextBlock();
				batch = dynamoResponse.Items;
				sourceIsEmpty = dynamoResponse.LastEvaluatedKey === undefined;
			}
			if (batch.length === 0) {
				return;
			}
			if (
				this.config.secondaryIndexes
				&& input.IndexName
				&& this.config.secondaryIndexes[input.IndexName].ProjectionType !== "ALL"
			) {
				const indexed = batch.shift();
				return this.get({
					[this._hashKey]: indexed[this._hashKey],
					[this._rangeKey]: indexed[this._rangeKey],
				});
			}

			return this.config.unMarshal(batch.shift());
		}) as IGenerator<Entity>;
		generator.toArray = generatorToArray;

		return generator;
	}

	public async count(input: ICountInput) {
		const documentClientInput = Object.assign(
			{},
			input,
			{
				Select: "COUNT",
				TableName: this.config.tableName,
			},
		);
		let total = 0;
		let response;
		do {
			response = await this.asyncRequest(documentClientInput);
			documentClientInput.ExclusiveStartKey = response.LastEvaluatedKey;
			total += response.Count;
		} while (response.LastEvaluatedKey);

		return total;
	}

	private buildScanBlockGenerator(input: ISearchInput) {
		const documentClientInput: DocumentClient.ScanInput | DocumentClient.QueryInput = Object.assign(
			{},
			input,
			{TableName: this.config.tableName},
		);
		const inputIsQuery = DynamoRepository.isQueryInput(documentClientInput);
		let lastEvaluatedKey: any;
		let sourceIsEmpty = false;
		if (input.ExclusiveStartKey !== undefined) {
			lastEvaluatedKey = input.ExclusiveStartKey;
		}

		return async () => {
			if (sourceIsEmpty) {
				return;
			}
			const blockInput = Object.assign(documentClientInput, {ExclusiveStartKey: lastEvaluatedKey});
			const response = await (inputIsQuery ? this.asyncQuery(blockInput) : this.asyncScan(blockInput));
			lastEvaluatedKey = response.LastEvaluatedKey;
			if (undefined === lastEvaluatedKey) {
				sourceIsEmpty = true;
			}

			return response;
		};
	}

	private asyncRequest(input: DocumentClient.QueryInput | DocumentClient.ScanInput) {
		return DynamoRepository.isQueryInput(input) ?
			this.asyncQuery(input) :
			this.asyncScan(input);
	}

	private asyncQuery(input: DocumentClient.QueryInput) {
		return new Promise<DocumentClient.QueryOutput>(
			(rs, rj) => this.dc.query(input, (err, res) => err ? rj(err) : rs(res)),
		);
	}

	private asyncScan(input: DocumentClient.ScanInput) {
		return new Promise<DocumentClient.ScanOutput>(
			(rs, rj) => this.dc.scan(input, (err, res) => err ? rj(err) : rs(res)),
		);
	}

	private asyncGet(input: DocumentClient.GetItemInput) {
		return new Promise<DocumentClient.GetItemOutput>(
			(rs, rj) => this.dc.get(input, (err, res) => err ? rj(err) : rs(res)),
		);
	}
}

function sameKey(key1: DocumentClient.Key, key2: DocumentClient.Key) {
	return Object.keys(key1).every((k) => key2[k] === key1[k]);
}

function uniqueKeys(arrArg: DocumentClient.Key[]) {
	return arrArg.reduce(
		(output, key) => output.some(
			(k2: DocumentClient.Key) => sameKey(key, k2),
		) ? output : output.concat([key]),
		[] as DocumentClient.Key[],
	);
}
