export default async function generatorToArray<Entity>() {
	const array: Entity[] = [];
	let entity: Entity;
	while (entity = await this()) {
		array.push(entity);
	}

	return array;
}
