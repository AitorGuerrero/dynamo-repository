import {DynamoDB} from "aws-sdk";
import {EventEmitter} from "events";

import DocumentClient = DynamoDB.DocumentClient;

export type TableName = string;

export default class FakeDocumentClient {

	public stepMode: boolean;
	public readonly collections: {[tableName: string]: {[hashKey: string]: {[rangeKey: string]: string}}};
	private readonly keySchemas: {[tableName: string]: {hashKey: string, rangeKey: string}};
	private resumed: Promise<any>;
	private resumedEventEmitter: EventEmitter;
	private shouldFail: boolean;
	private error: Error;
	private hashKey: string;
	private rangeKey: string;

	constructor(
		keySchemas: {[tableName: string]: DocumentClient.KeySchema},
	) {
		this.resumed = Promise.resolve();
		this.stepMode = false;
		this.resumedEventEmitter = new EventEmitter();
		this.shouldFail = false;
		this.collections = {};
		this.keySchemas = {};
		for (const tableName of Object.keys(keySchemas)) {
			this.keySchemas[tableName] = {
				hashKey: keySchemas[tableName].find((ks) => ks.KeyType === "HASH").AttributeName,
				rangeKey: keySchemas[tableName].find((ks) => ks.KeyType === "RANGE") === undefined ?
					undefined :
					keySchemas[tableName].find((ks) => ks.KeyType === "RANGE").AttributeName,
			};
		}
	}

	public async get(
		input: DocumentClient.GetItemInput,
		cb: (err?: Error, result?: DocumentClient.GetItemOutput) => any,
	) {
		await this.awaitFlush();
		this.guardShouldFail(cb);
		const hashKey = input.Key[this.keySchemas[input.TableName].hashKey];
		const rangeKey = input.Key[this.keySchemas[input.TableName].rangeKey];
		this.ensureHashKey(input.TableName, hashKey);
		const marshaled = this.collections[input.TableName][hashKey][rangeKey];
		cb(null, {Item: marshaled ? JSON.parse(this.collections[input.TableName][hashKey][rangeKey]) : undefined});
	}

	public async set(tableName: TableName, item: DocumentClient.AttributeMap) {
		await new Promise((rs) => this.put({TableName: tableName, Item: item}, () => rs()));
	}

	public getByKey<IEntity>(tableName: TableName, key: DocumentClient.Key): IEntity {
		return new Promise((rs) => this.get({TableName: tableName, Key: key}, (err, result) => rs(result.Item))) as any;
	}

	public async batchGet(
		input: DocumentClient.BatchGetItemInput,
		cb: (err?: Error, result?: DocumentClient.BatchGetItemOutput) => any,
	) {
		await this.awaitFlush();
		this.guardShouldFail(cb);
		const response: DocumentClient.BatchGetItemOutput = {Responses: {}};
		for (const tableName in input.RequestItems) {
			response.Responses[tableName] = [];
			for (const request of input.RequestItems[tableName].Keys) {
				const hashKey = request[this.keySchemas[tableName].hashKey];
				const rangeKey = request[this.keySchemas[tableName].rangeKey];
				this.ensureHashKey(tableName, hashKey);
				const item = this.collections[tableName][hashKey][rangeKey];
				if (item !== undefined) {
					response.Responses[tableName].push(JSON.parse(item));
				}
			}
		}
		cb(null, response);
	}

	public async scan(
		input: DocumentClient.ScanInput,
		cb: (err?: Error, result?: DocumentClient.ScanOutput) => any,
	) {
		await this.awaitFlush();
		this.guardShouldFail(cb);
		const response: DocumentClient.ScanOutput = {Items: []};
		const startKey = this.getStartKey(input.TableName, input.ExclusiveStartKey);
		const existingHashKeys = Object.keys(this.collections[input.TableName]);
		let hashKey = startKey.hash;
		let rangeKey = startKey.range;
		let rangeKeys = Object.keys(this.collections[input.TableName][hashKey]);
		while (this.collections[input.TableName][hashKey] !== undefined) {
			while (rangeKey !== undefined && this.collections[input.TableName][hashKey][rangeKey] !== undefined) {
				response.Items.push(JSON.parse(this.collections[input.TableName][hashKey][rangeKey]));
				rangeKey = rangeKeys[rangeKeys.indexOf(rangeKey) + 1];
			}
			hashKey = existingHashKeys[existingHashKeys.indexOf(hashKey) + 1];
			if (hashKey === undefined) {
				break;
			}
			rangeKeys = Object.keys(this.collections[input.TableName][hashKey]);
			rangeKey = rangeKeys[0];
		}
		if (hashKey !== undefined) {
			response.LastEvaluatedKey = {
				[this.keySchemas[input.TableName].hashKey]: hashKey,
				[this.keySchemas[input.TableName].rangeKey]: rangeKey,
			};
		}

		cb(null, response);
	}

	public async query(
		input: DocumentClient.QueryInput,
		cb: (err?: Error, result?: DocumentClient.QueryOutput) => any,
	) {
		await this.awaitFlush();
		this.guardShouldFail(cb);
		const response: DocumentClient.ScanOutput = {Items: []};
		const startKey = this.getStartKey(input.TableName, input.ExclusiveStartKey);
		const hashKeys = Object.keys(this.collections[input.TableName]);
		let hashKey = startKey.hash;
		let rangeKey = startKey.range;
		let rangeKeys = Object.keys(this.collections[input.TableName][hashKey]);
		while (this.collections[input.TableName][hashKey] !== undefined) {
			while (rangeKey !== undefined && this.collections[input.TableName][hashKey][rangeKey] !== undefined) {
				response.Items.push(JSON.parse(this.collections[input.TableName][hashKey][rangeKey]));
				rangeKey = rangeKeys[rangeKeys.indexOf(rangeKey) + 1];
			}
			hashKey = hashKeys[hashKeys.indexOf(hashKey) + 1];
			if (hashKey === undefined) {
				break;
			}
			rangeKeys = Object.keys(this.collections[input.TableName][hashKey]);
			rangeKey = rangeKeys[0];
		}
		if (hashKey !== undefined) {
			response.LastEvaluatedKey = {
				[this.keySchemas[input.TableName].hashKey]: hashKey,
				[this.keySchemas[input.TableName].rangeKey]: rangeKey,
			};
		}

		cb(null, response);
	}

	public async update(
		input: DocumentClient.UpdateItemInput,
		cb: (err?: Error, result?: DocumentClient.UpdateItemOutput) => any,
	) {
		await this.awaitFlush();
		this.guardShouldFail(cb);
		const item = await this.getByKey(input.TableName, input.Key);
		const updates: Array<{k: string, v: any}> = /UPDATE/.test(input.UpdateExpression) ?
			/UPDATE ([^,]*)/.exec(input.UpdateExpression)[1]
				.split(" AND ").map((s) => s.replace(" ", "").split("="))
				.map((s) => ({k: s[0], v: s[1]})) :
			[];
		const deletes: string[] = /DELETE/.test(input.UpdateExpression) ?
			/DELETE ([^,]*)/.exec(input.UpdateExpression)[1]
				.split(" AND ").map((s) => s.replace(" ", "")) :
			[];

		for (const update of updates) {
			let toUpdate: any = item;
			for (const k of update.k.split(".")) {
				const realName = input.ExpressionAttributeNames[k];
				if (typeof toUpdate[realName] !== "object") {
					toUpdate[realName] = input.ExpressionAttributeValues[update.v];
					continue;
				}
				toUpdate = toUpdate[realName];
			}
		}
		for (const deleteField of deletes) {
			let toDelete: any = item;
			for (const k of deleteField.split(".")) {
				const realName = input.ExpressionAttributeNames[k];
				if (typeof toDelete[realName] !== "object") {
					toDelete[realName] = undefined;
					continue;
				}
				toDelete = toDelete[realName];
			}
		}
		await this.set(input.TableName, item);

		cb(null, {});
	}

	public async put(
		input: DocumentClient.PutItemInput,
		cb: (err?: Error, result?: DocumentClient.PutItemOutput) => any,
	) {
		await this.awaitFlush();
		this.guardShouldFail(cb);
		const hashKey = input.Item[this.keySchemas[input.TableName].hashKey];
		const rangeKey = input.Item[this.keySchemas[input.TableName].rangeKey];
		this.ensureHashKey(input.TableName, hashKey);
		this.collections[input.TableName][hashKey][rangeKey] = JSON.stringify(input.Item);
		cb(null, {});
	}

	public async delete(
		input: DocumentClient.DeleteItemInput,
		cb: (err?: Error, result?: DocumentClient.DeleteItemOutput) => any,
	) {
		const hashKey = input.Key[this.keySchemas[input.TableName].hashKey];
		const rangeKey = input.Key[this.keySchemas[input.TableName].rangeKey];
		this.collections[input.TableName][hashKey][rangeKey] = undefined;
		cb(null, {});
	}

	public flush() {
		this.resumedEventEmitter.emit("resumed");
		this.resumed = new Promise((rs) => this.resumedEventEmitter.once("resumed", rs));
	}

	public failOnCall(error?: Error) {
		this.shouldFail = true;
		this.error = error;
	}

	private getStartKey(tableName: string, exclusiveStartKey: DocumentClient.Key) {
		let range: string;
		let hash: string;

		if (exclusiveStartKey === undefined) {
			hash = Object.keys(this.collections[tableName])[0];
			range = Object.keys(this.collections[tableName][hash])[0];
			return {hash, range};
		}

		hash = exclusiveStartKey[this.keySchemas[tableName].hashKey];
		const rangeKeys = Object.keys(this.collections[tableName][exclusiveStartKey[this.keySchemas[tableName].hashKey]]);
		range = rangeKeys[rangeKeys.indexOf(exclusiveStartKey[this.keySchemas[tableName].rangeKey]) + 1];
		if (range === undefined) {
			const hashKeys = Object.keys(this.collections[tableName]);
			hash = hashKeys[hashKeys.indexOf(hash) + 1];
			range = Object.keys(this.collections[tableName][hash])[0];
		}

		return {hash, range};
	}

	private async awaitFlush() {
		if (this.stepMode) {
			await this.resumed;
		}
	}

	private guardShouldFail(cb: (err: Error) => any) {
		if (this.shouldFail === false) {
			return;
		}
		const error = this.error !== undefined ? this.error : new Error("Repository error");
		cb(error);
		throw error;
	}

	private ensureHashKey(tableName: string, hashKey: string) {
		if (this.collections[tableName] === undefined) {
			this.collections[tableName] = {};
		}
		if (this.collections[tableName][hashKey] === undefined) {
			this.collections[tableName][hashKey] = {};
		}
	}
}
