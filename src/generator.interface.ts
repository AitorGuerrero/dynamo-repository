export interface IGenerator<Entity> {
	(): Promise<Entity>;
	toArray(): Promise<Entity[]>;
}