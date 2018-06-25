export default class TrackedEntitiesCollisionError<Entity> extends Error {
	constructor(
		public cachedEntity: Entity,
		public newEntity: Entity,
	) {
		super("TrackedEntitiesCollisionError");
		this.name = "TrackedEntitiesCollisionError";
	}
}
