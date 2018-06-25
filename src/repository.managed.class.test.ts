import {expect} from "chai";
import {beforeEach, describe, it} from "mocha";
import FakeDocumentClient from "./fake-document-client.class";
import {ManagedDynamoRepository} from "./repository.managed.class";

describe("Having a entity manager", () => {

	const keySchema = [{AttributeName: "id", KeyType: "HASH"}];

	class Entity {
		public updated: boolean;
		public toDelete: boolean;
		public nested = {nestedUpdated: false, nestedToDelete: true};
		constructor(public id: string) {}
	}

	function unMarshal(m: any): Entity {
		const e = new Entity(m.id);
		e.updated = m.updated;
		e.toDelete = m.toDelete;
		e.nested = m.nested;

		return e;
	}

	function marshal(e: Entity) {
		return JSON.parse(JSON.stringify(e));
	}

	const tableName = "tableName";
	const entityId = "entityId";

	let documentClient: FakeDocumentClient;
	let repository: ManagedDynamoRepository<Entity>;

	beforeEach(async () => {
		documentClient = new FakeDocumentClient({[tableName]: keySchema});
		repository = new ManagedDynamoRepository(
			documentClient as any,
			{
				keySchema,
				marshal,
				tableName,
				unMarshal,
			},
		);
	});

	describe("and having a entity in document client", () => {

		let entity: Entity;
		let marshaledEntity: Entity;

		beforeEach(async () => {
			marshaledEntity = {
				id: entityId,
				nested: {nestedUpdated: false, nestedToDelete: true},
				toDelete: true,
				updated: false,
			};
			await documentClient.set(tableName, marshaledEntity);
			entity = await repository.get({id: entityId});
		});

		describe("and updating a nested attribute", () => {
			beforeEach(async () => entity.nested.nestedUpdated = true);
			describe("and flushed", () => {
				beforeEach(() => repository.flush());
				it("should update the item in the collection", async () => {
					const item = await documentClient.getByKey<Entity>(tableName, {id: entityId});
					expect(item.nested.nestedUpdated).to.be.true;
				});
			});
		});

		describe("and updating a attribute", () => {
			beforeEach(async () => entity.updated = true);
			describe("and flushed", () => {
				beforeEach(() => repository.flush());
				it("should update the item in the collection", async () => {
					const item = await documentClient.getByKey<Entity>(tableName, {id: entityId});
					expect(item.updated).to.be.true;
				});
			});
		});

		describe("and deleting a attribute", () => {
			beforeEach(async () => entity.toDelete = undefined);
			describe("and flushed", () => {
				beforeEach(() => repository.flush());
				it("should update the item in the collection", async () => {
					const item = await documentClient.getByKey<Entity>(tableName, {id: entityId});
					expect(item.toDelete).to.be.undefined;
				});
			});
		});

		describe("and deleting a nested attribute", () => {
			beforeEach(async () => entity.nested.nestedToDelete = undefined);
			describe("and flushed", () => {
				beforeEach(() => repository.flush());
				it("should update the item in the collection", async () => {
					const item = await documentClient.getByKey<Entity>(tableName, {id: entityId});
					console.log(JSON.stringify(item));
					expect(item.nested.nestedToDelete).to.be.undefined;
				});
			});
		});

		describe("and the entity is same as original", () => {
			it("should not update the item in the collection", async () => {
				documentClient.failOnCall();
				await repository.flush();
			});
		});

		describe("and deleting a entity", () => {
			it("should remove it from collection", async () => {
				repository.delete(entity);
				await repository.flush();
				expect(await documentClient.getByKey(tableName, {id: entityId})).to.be.undefined;
			});
		});
	});

	describe("when persisting a new entity", () => {
		const newId = "newId";
		let entity: Entity;
		beforeEach(async () => {
			entity = new Entity(newId);
			await repository.trackNew(entity);
		});
		describe("and flushed", () => {
			beforeEach(() => repository.flush());
			it("should save the item in the collection", async () => {
				const item = await documentClient.getByKey<Entity>(tableName, {id: newId});
				expect(item).not.to.be.undefined;
			});
			it("should marshal the item", async () => {
				const item = await documentClient.getByKey<Entity>(tableName, {id: newId});
				expect(item).not.to.be.instanceOf(Entity);
			});
			describe("and deleting it", () => {
				beforeEach(() => repository.delete(entity));
				describe("and flushed", () => {
					beforeEach(() => repository.flush());
					it("Should not be added to the collection", async () => {
						expect(await documentClient.getByKey(tableName, {id: entityId})).to.be.undefined;
					});
				});
			});
		});
	});
});
