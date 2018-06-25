import {DynamoDB} from "aws-sdk";
import generatorToArray from "./generator-to-array";
import getEntityKey from "./get-entity-key";
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

	protected readonly config: ITableConfig<Entity>;
	private readonly _hashKey: string;
	private readonly _rangeKey: string;

	/**
	 * @param {DocumentClient} dc
	 * @param {ITableConfig<Entity>} config
	 */
	constructor(
		protected dc: DocumentClient,
		config: ITableConfig<Entity>,
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
	}

	/**
	 * If there is not entity with the key, it returns undefined.
	 * @param {DocumentClient.Key} Key
	 * @returns {Promise<Entity>}
	 */
	public async get(Key: DocumentClient.Key) {
		const input: DocumentClient.GetItemInput = {
			Key,
			TableName: this.config.tableName,
		};
		const response = await this.asyncGet(input);

		return response.Item === undefined ? undefined : this.config.unMarshal(response.Item);
	}

	/**
	 * If the entity does not exists, returns the position of the key in the map with undefined value.
	 * @param {DocumentClient.Key[]} keys
	 * @returns {Promise<Map<DocumentClient.Key, Entity>>} The key is the same object of the input.
	 */
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

	/**
	 * Returns a generator function. That function returns a Promise<Entity> object. When there are not more entities,
	 * it returns Promise<undefined>. If you want to iterate the result, yo should use:
	 * ```typescript
	 * const getEntity = repository.search({});
	 * let entity;
	 * for (entity of await getEntity()) {
	 *      // use the entity
	 * }
	 * ```
	 * Or you can convert it to an array with
	 * ```typescript
	 * const entities = await repository.search({}).toArray();
	 * ```
	 * But converting it to array in large results, you increase the Dynamo provisioning consumption.
	 * @param {ISearchInput} input
	 * @returns {IGenerator<Entity>}
	 */
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

	/**
	 * Returns the total amount of entities for the search
	 * @param {ICountInput} input
	 * @returns {Promise<number>}
	 */
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
