import {DynamoDB} from "aws-sdk";
import {EventEmitter} from "events";
import DocumentClient = DynamoDB.DocumentClient;
import generatorToArray from "./generator-to-array";
import getEntityKey from "./get-entity-key";
import {DynamoRepository} from "./repository.class";
import {ITableConfig} from "./table-config.interface";
import {IGenerator} from "./generator.interface";
import {ISearchInput} from "./search-input.interface";

/**
 * Launched event types throw cachedDynamoRepository.eventEmitter
 */
export enum EventTypes {
	/**
	 * It's triyng to add a entity to a used cached key.
	 */
	cacheKeyInUse = "warning.cacheKeyInUse",
}

export class CachedDynamoRepository<Entity> extends DynamoRepository<Entity> {

	/**
	 * Class event emitter. For event types, see EventTypes
	 */
	public readonly eventEmitter: EventEmitter;

	private readonly cache: Map<any, Map<any, Promise<Entity>>>;
	private readonly hashKey: string;
	private readonly rangeKey: string;

	/**
	 * @param {DocumentClient} dc
	 * @param {ITableConfig<Entity>} config
	 * @param {module:events.internal.EventEmitter} eventEmitter
	 */
	constructor(
		dc: DocumentClient,
		config: ITableConfig<Entity>,
		eventEmitter?: EventEmitter,
	) {
		super(dc, config);
		this.cache = new Map();
		this.hashKey = this.config.keySchema.find((k) => k.KeyType === "HASH").AttributeName;
		const rangeSchema = this.config.keySchema.find((k) => k.KeyType === "RANGE");
		this.rangeKey = rangeSchema ? rangeSchema.AttributeName : undefined;
		this.eventEmitter = eventEmitter || new EventEmitter();
	}

	/**
	 * @param {DocumentClient.Key} key
	 * @returns {Promise<Entity>}
	 */
	public get(key: DocumentClient.Key): Promise<Entity> {
		if (!this.cache.has(key[this.hashKey])) {
			this.cache.set(key[this.hashKey], new Map());
		}
		if (!this.cache.get(key[this.hashKey]).has(key[this.rangeKey])) {
			this.cache.get(key[this.hashKey]).set(key[this.rangeKey], super.get(key));
		}
		return this.cache.get(key[this.hashKey]).get(key[this.rangeKey]);
	}

	/**
	 * @param {DocumentClient.Key[]} keys
	 * @returns {Promise<Map<DocumentClient.Key, Entity>>} The key is the same object of the input.
	 */
	public async getList(keys: DocumentClient.Key[]) {
		const result = new Map<DocumentClient.Key, Entity>();
		const notCachedKeys: DocumentClient.Key[] = [];
		for (const key of keys) {
			if (!this.keyIsCached(key)) {
				notCachedKeys.push(key);
			}
		}
		if (notCachedKeys.length > 0) {
			const response = await super.getList(notCachedKeys);
			for (const key of notCachedKeys) {
				const entity = response.get(key);
				await this.addToCacheByKey(key, entity);
				result.set(key, await this.getFromCache(key));
			}
		}
		for (const key of keys) {
			result.set(key, await this.getFromCache(key));
		}

		return result;
	}

	/**
	 * @param {ISearchInput} input
	 * @returns {IGenerator<Entity>}
	 */
	public search(input: ISearchInput) {
		const getNextEntity = super.search(input);
		const generator = (async () => {
			const entity = await getNextEntity();
			if (entity === undefined) {
				return;
			}
			const key = this.getEntityKey(entity);
			await this.addToCacheByKey(key, entity);

			return this.getFromCache(key);
		}) as IGenerator<Entity>;
		generator.toArray = generatorToArray;

		return generator;
	}

	/**
	 * A helper for getting the entity key in DocumentClient.Key interface
	 * @param {Entity} e
	 * @returns {DocumentClient.Key}
	 */
	public getEntityKey(e: Entity) {
		return getEntityKey(this.config.keySchema, this.config.marshal(e));
	}

	/**
	 * @param {Entity} e
	 * @returns {Promise<void>}
	 */
	public async addToCache(e: Entity) {
		await this.addToCacheByKey(this.getEntityKey(e), e);
	}

	public clearCache() {
		this.cache.clear();
	}

	private keyIsCached(key: DocumentClient.Key) {
		return this.cache.has(key[this.hashKey]) && this.cache.get(key[this.hashKey]).has(key[this.rangeKey]);
	}

	private getFromCache(key: DocumentClient.Key) {
		if (!this.cache.has(key[this.hashKey])) {
			return;
		}
		return this.cache.get(key[this.hashKey]).get(key[this.rangeKey]);
	}

	private async addToCacheByKey(key: DocumentClient.Key, entity: Entity) {
		const currentCached = await this.getFromCache(key);
		if (currentCached !== undefined) {
			if (currentCached !== entity) {
				this.eventEmitter.emit(EventTypes.cacheKeyInUse, {
					cachedItem: this.getFromCache(key),
					newItem: entity,
				});
			}
			return;
		}
		if (!this.cache.has(key[this.hashKey])) {
			this.cache.set(key[this.hashKey], new Map());
		}
		this.cache.get(key[this.hashKey]).set(key[this.rangeKey], Promise.resolve(entity));
	}
}
