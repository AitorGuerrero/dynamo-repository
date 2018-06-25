# Dynamo Repository

Some helpers for simply managing dynamo tables. Implements caching, entity manager and searchs by async generator. This
helpers are not intended for use in batch processes, they'r main purpose is for DDD use cases.

There are 3 main classes:

- DynamoRepository: A simple repository with helpers for simple searching (for example, invisible async paginating).
- CachedDynamoRepository: Extends DynamoRepository. Adds in memory caching.
- ManagedDynamoRepository: Extends  CachedDynamoRepository. Adds entity managing. It stores initial entity status, and,
on flushing, persists the entity if modified, created or deleted.

## Getting Started
```typescript
import {DynamoDB} from 'aws-sdk';
import {ManagedDynamoRepository} from 'dynamo-repository';

const documentClient = new DynamoDB.DocumentClient();
const repository = new ManagedDynamoRepository(
    documentClient,
    {
        tableName: 'myTableName',
        keySchema: [{AttributeName: 'id', AttributeType: 'HASH'}],
    },
);

// Getting a single entity by the key
const entity = await repository.get({id: 'myEntityId'});
console.log(entity);

// Getting some entities by a search
const getEntity = repository.search({
    IndexName: 'myIndex',
    ExpressionAttributeValues: {':secondaryIndexHashKey': 'mySecondaryIndexHashKey'},
    KeyConditionExpression: 'secondaryIndexHashKey=:secondaryIndexHashKey',
});
let foundEntity;
while (foundEntity = await getEntity()) {
    console.log(foundEntity);
}
```

### Prerequisites

Requires aws-sdk package (if executed in AWS Lambda, it is already installed).

```
npm install --save-dev aws-sdk
```

## npm scripts

Build the js files from typescript:
```
npm run build
```

Running tests:
```
npm run test
```

Running style check:
```
npm run style
```

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct, and the process for submitting pull requests to us.

## Versioning

We use [SemVer](http://semver.org/) for versioning. For the versions available, see the tags on this repository.

## Authors

* **Aitor Guerrero** - *Initial work* - [AitorGuerrero](https://github.com/AitorGuerrero)

## License

This project is licensed under the ISC License - see the [LICENSE.md](LICENSE.md) file for details

