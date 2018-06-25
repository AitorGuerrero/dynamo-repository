/* tslint:disable:ban-types */
import {DynamoDB} from "aws-sdk";
import {EventEmitter} from "events";
import getEntityKey from "./get-entity-key";

import generatorToArray from "./generator-to-array";
import {CachedDynamoRepository} from "./repository.cached.class";
import {ITableConfig} from "./table-config.interface";
import {ISearchInput} from "./search-input.interface";
import {IGenerator} from "./generator.interface";

type Action = "CREATE" | "UPDATE" | "DELETE";

export enum eventType {
	flushed = "flushed",
	errorCreating = "error.creating",
	errorUpdating = "error.updating",
	errorDeleting = "error.deleting",
	errorFlushing = "error.flushing",
}

type TrackedTable = Map<any, {action: Action, initialStatus?: any, entity: any}>;

export class ManagedDynamoRepository<Entity> extends CachedDynamoRepository<Entity> {

	private tracked: TrackedTable;

	/**
	 * @param {DynamoDB.DocumentClient} dc
	 * @param {ITableConfig<Entity>} config
	 * @param {module:events.internal.EventEmitter} eventEmitter
	 */
	constructor(
		dc: DynamoDB.DocumentClient,
		config: ITableConfig<Entity>,
		eventEmitter?: EventEmitter,
	) {
		super(dc, config, eventEmitter);
		this.tracked = new Map();
	}

	/**
	 * @param {DynamoDB.DocumentClient.Key} key
	 * @returns {Promise<Entity>}
	 */
	public async get(key: DynamoDB.DocumentClient.Key) {
		const entity = await super.get(key);
		this.track(entity);

		return entity;
	}

	/**
	 * @param {DynamoDB.DocumentClient.Key[]} keys
	 * @returns {Promise<Map<DocumentClient.Key, Entity>>}
	 */
	public async getList(keys: DynamoDB.DocumentClient.Key[]) {
		const list = await super.getList(keys);
		for (const entity of list.values()) {
			this.track(entity);
		}

		return list;
	}

	/**
	 * @param {ISearchInput} input
	 * @returns {IGenerator<Entity>}
	 */
	public search(input: ISearchInput) {
		const generator = super.search(input);
		const managedGenerator = (async () => {
			const entity = await generator();
			this.track(entity);

			return entity;
		}) as IGenerator<Entity>;
		managedGenerator.toArray = generatorToArray;

		return managedGenerator;
	}

	/**
	 * Flush tracked entities, persisting the changes.
	 * @returns {Promise<void>}
	 */
	public async flush() {
		const processed: Array<Promise<any>> = [];
		for (const entityConfig of this.tracked.values()) {
			switch (entityConfig.action) {
				case "UPDATE":
					processed.push(this.updateItem(entityConfig.entity));
					break;
				case "DELETE":
					processed.push(this.deleteItem(entityConfig.entity));
					break;
				case "CREATE":
					processed.push(this.createItem(entityConfig.entity));
					break;
			}
		}
		try {
			await Promise.all(processed);
		} catch (err) {
			this.eventEmitter.emit(eventType.errorFlushing);

			throw err;
		}
		this.eventEmitter.emit(eventType.flushed);
	}

	/**
	 * Tracks a existing entity. When flushed, it will update the entity of the table.
	 * If the entity does not changes, it will not be persisted.
	 * In a future version, it will fail if the entity does not exists in the table.
	 * @param {Entity} entity
	 */
	public track(entity: Entity) {
		if (entity === undefined) {
			return;
		}
		if (this.tracked.has(entity)) {
			return;
		}
		this.tracked.set(entity, {action: "UPDATE", initialStatus: JSON.stringify(entity), entity});
	}

	/**
	 * Tracks a new entity. When flushed, it will create the entity in the table.
	 * It will be persisted even if the entity does not changes.
	 * In a future version, it will fail if it exists in the table.
	 * @param {Entity} entity
	 * @returns {Promise<void>}
	 */
	public async trackNew(entity: Entity) {
		await super.addToCache(entity);
		if (entity === undefined) {
			return;
		}
		if (this.tracked.has(entity)) {
			return;
		}
		this.tracked.set(entity, {action: "CREATE", entity});
	}

	public delete(entity: Entity) {
		if (entity === undefined) {
			return;
		}
		if (
			this.tracked.has(entity)
			&& this.tracked.get(entity).action === "CREATE"
		) {
			this.tracked.delete(entity);
		} else {
			this.tracked.set(entity, {action: "DELETE", entity});
		}
	}

	public clearTrackedEntities() {
		this.tracked = new Map();
	}

	private async createItem(entity: Entity) {
		const request = {
			Item: this.config.marshal(entity),
			TableName: this.config.tableName,
		};
		try {
			await this.asyncPut(request);
		} catch (err) {
			this.eventEmitter.emit(eventType.errorCreating, err, entity);

			throw err;
		}
	}

	private async updateItem(entity: Entity) {
		if (!this.entityHasChanged(entity)) {
			return;
		}
		const request = {
			Item: this.config.marshal(entity),
			TableName: this.config.tableName,
		};
		try {
			await this.asyncPut(request);
		} catch (err) {
			this.eventEmitter.emit(eventType.errorUpdating, err, entity);

			throw err;
		}
	}

	private entityHasChanged<E>(entity: Entity) {
		return JSON.stringify(entity) !== this.tracked.get(entity).initialStatus;
	}

	private async deleteItem(item: Entity) {
		try {
			return this.asyncDelete({
				Key: getEntityKey(this.config.keySchema, this.config.marshal(item)),
				TableName: this.config.tableName,
			});
		} catch (err) {
			this.eventEmitter.emit(eventType.errorDeleting, err, item);

			throw err;
		}
	}

	private asyncPut(request: DynamoDB.DocumentClient.PutItemInput) {
		return new Promise<DynamoDB.DocumentClient.PutItemOutput>(
			(rs, rj) => this.dc.put(request, (err, res) => err ? rj(err) : rs(res)),
		);
	}

	private asyncDelete(request: DynamoDB.DocumentClient.DeleteItemInput) {
		return new Promise<DynamoDB.DocumentClient.DeleteItemOutput>(
			(rs, rj) => this.dc.delete(request, (err) => err ? rj(err) : rs()),
		);
	}
}
