# mongo-collections

[![Documentation](https://img.shields.io/badge/docs-GitHub%20Pages-blue)](https://ideativedigital.github.io/mongo-collections/)
[![Coverage](https://img.shields.io/badge/coverage-CI%20pending-lightgrey)](https://github.com/acominotto/mongo-collections/actions)

Strongly-typed MongoDB collections with optional document transformers (substituers), domain errors, and a small service layer. Built on the official [mongodb](https://www.npmjs.com/package/mongodb) driver.

## Features

- **Typed collections** — Document types flow through find/insert/update/delete
- **Domain errors** — `NotFoundError`, `DuplicateError`, `BadParametersError` instead of raw driver results
- **Substituers** — Optional `in`/`out` transforms for filters and documents (e.g. id/field mapping)
- **Collection definitions** — `colDef()` + `mongoDatabase()` for a typed set of collections with shared `ensureIndexes`, `gridfs`, and `withTransaction`
- **GridFS** — `GridFSBucketProxy` for async bucket access
- **Transactions** — `MongoService.withTransaction` and transactional helpers on `Collection`
- **Next.js API Routes** — `MongoResource` generates RESTful handlers (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS) for Next.js App Router

## Installation

```bash
pnpm add mongo-collections
# or
npm install mongo-collections
```

**Peer dependency:** `mongodb` (e.g. `^7.0.0`).

## Quick start

```ts
import {
  MongoService,
  colDef,
  mongoDatabase,
  wrapMongoCollection,
  type Document,
} from "mongo-collections";

// Document type (must have id for collection helpers)
type User = { _id: string; name: string; email: string };

// Create service and get typed collections
const service = MongoService.create(process.env.MONGO_URI!);

// Or a full set of collections (typed + ensureIndexes + gridfs + withTransaction)
const db = mongoDatabase(service, {
  users: colDef<User>({
    indexes: [{ spec: { email: 1 }, options: { unique: true } }],
  }),
  // other collections...
});
await db.ensureIndexes();

// Use the collection
const user = await db.users.getById("some-id"); // throws NotFoundError if missing
const one = await db.users.findOne({ email: "a@b.com" }); // null if not found
await db.users.insert({ _id: "1", name: "Alice", email: "alice@example.com" });
```

## Collection API

`Collection<T>` (and collections returned by `mongoDatabase`) expose:

| Method                                    | Description                                               |
| ----------------------------------------- | --------------------------------------------------------- |
| `findById` / `getById`                    | By `id` (optional `ignoreCase`) — get throws if not found |
| `findOne` / `getOne`                      | By filter — get throws if not found                       |
| `find` / `cursor`                         | Multiple documents; results transformed with `toApi`      |
| `insert` / `insertMany`                   | Insert; throws `DuplicateError` on duplicate key          |
| `updateOne` / `updateMany` / `updatebyId` | Update by filter or id                                    |
| `replaceOne`                              | Replace one document                                      |
| `findOneAndUpdate` / `getOneAndUpdate`    | Find + update (optional return doc)                       |
| `findOneAndReplace` / `getOneAndReplace`  | Find + replace                                            |
| `findOneAndDelete` / `getOneAndDelete`    | Find + delete; returns deleted doc                        |
| `deleteOne` / `deleteById` / `deleteMany` | Delete; return result only                                |
| `count` / `exists`                        | Count or boolean existence                                |
| `findThenUpdateOne` / `getThenUpdateOne`  | Transactional: find → transform → update                  |
| `ensureIndexes`                           | Create indexes from collection definition                 |
| `nextCounterValue`                        | Atomic counter for this collection name                   |
| `underlying`                              | Native MongoDB `Collection<T>`                            |
| `fromApi` / `toApi`                       | Apply substituers for write/read                          |

Methods named `get*` or `*ById` with “get” throw `NotFoundError` or `BadParametersError` when no document is found; `find*` return `null` instead.

## Substituers

Substituers transform values during deep traversal. Use them to map ids (e.g. string ↔ ObjectId), rename fields, or normalize shapes between API and storage.

- **`in`** — Applied to filters, updates, and documents **before** sending to MongoDB.
- **`out`** — Applied to documents **after** reading from MongoDB (e.g. to API shape). `fromApi`/`toApi` use these.

### Single rule: `substitute(condition, replace)`

```ts
import { substitute, type Substituer } from "mongo-collections";
import { ObjectId } from "mongodb";

const objectIdIn: Substituer = substitute(
  (x): x is string => typeof x === "string" && /^[0-9a-fA-F]{24}$/.test(x),
  (id) => new ObjectId(id)
);
const objectIdOut: Substituer = substitute(
  (x): x is ObjectId => x instanceof ObjectId,
  (id) => id.toHexString()
);

const col = new Collection(service, "users", [], {
  in: objectIdIn,
  out: objectIdOut,
});
```

### Chaining: `.and(other)`

```ts
const transform = objectIdOut.and(dateToIso).and(someOtherSubstituer);
```

### Building complex substituers: `substituteBuilder()`

```ts
import { substituteBuilder, substitute } from "mongo-collections";

const out = substituteBuilder()
  .when(
    (x): x is Date => x instanceof Date,
    (d) => d.toISOString()
  )
  .when(
    (x): x is ObjectId => x instanceof ObjectId,
    (id) => id.toHexString()
  )
  .when(
    (x): x is RegExp => x instanceof RegExp,
    (r) => r.source
  )
  .then(
    substitute(
      (x): x is Map<string, unknown> => x instanceof Map,
      (m) => Object.fromEntries(m)
    )
  )
  .build();

const col = new Collection(service, "things", [], { out });
```

- **`.when(condition, replace)`** — Add a rule; first matching rule wins per value.
- **`.then(substituer)`** — Compose: result = `substituer(built(doc))`.
- **`.build()`** — Returns a `Substituer` (with `.and()` for further chaining).

## API Model <-> DB Model (simple mapper)

When your API shape differs from your MongoDB shape, use a `mapper` on the collection. This keeps route handlers and business code in API types while persistence uses DB types.

```ts
import {
  modelMapper,
  wrapMongoCollection,
  type Document,
} from "mongo-collections";

type ApiUser = { id: string; name: string };
type DbUser = { _id: string; db_name: string };

const users = wrapMongoCollection<ApiUser, DbUser>(service, "users", [], {
  mapper: modelMapper<ApiUser, DbUser>({
    toDb: (api) => ({ _id: api.id, db_name: api.name }),
    toApi: (db) => ({ id: db._id, name: db.db_name }),
    filterToDb: (filter) => {
      const f = { ...(filter as any) };
      if ("name" in f) {
        f.db_name = f.name;
        delete f.name;
      }
      return f;
    },
    updateToDb: (update) => {
      const u = { ...(update as any) };
      if (u.$set?.name) {
        u.$set = { ...u.$set, db_name: u.$set.name };
        delete u.$set.name;
      }
      return u;
    },
  }),
});
```

Notes:

- `toDb` is used for inserts and when `MongoResource` builds default update payloads.
- `toApi` is used for read results.
- `filterToDb` and `updateToDb` are optional but recommended when field names differ.
- Existing `substituers` still work; mapper is the explicit option for API/DB model divergence.

## Errors

Domain errors are thrown instead of returning driver result objects where it makes sense:

```ts
import {
  NotFoundError,
  DuplicateError,
  BadParametersError,
  MongoErrors,
} from "mongo-collections";
// or from 'mongo-collections/errors'
```

| Error                | When                                                           |
| -------------------- | -------------------------------------------------------------- |
| `NotFoundError`      | `getById`, `getOne`, etc. when no document is found            |
| `BadParametersError` | `getOne` when filter matches nothing (message includes filter) |
| `DuplicateError`     | `insert` / `insertMany` on duplicate key (MongoDB code 11000)  |

`MongoErrors` exposes `DUPLICATE_KEY: 11000` and `WRITE_CONFLICT: 112` for checks.

## MongoService

- **`MongoService.create(connectionString)`** — Create a service (optionally pass `MongoClientOptions`).
- **`getDB()`** — Raw MongoDB `Db` (with retries).
- **`nativeCollection<T>(name)`** — Raw driver `Collection<T>`.
- **`getCollection(name, colDefinition)`** — Typed `Collection<T>` from a `ColDefinition<T>`.
- **`withTransaction(fn)`** — Run a function inside a transaction (start/commit/abort/endSession).
- **`gridfs()`** — Native `GridFSBucket`.
- **`nextCounterValue(counterName)`** — Atomic counter in `__counters` collection.

In development, the client promise is stored on `global` so it survives HMR.

## GridFS

When using `mongoDatabase`, you get a `gridfs` property that is a `GridFSBucketProxy` — an async wrapper around `GridFSBucket` with the same API (all methods return promises):

```ts
const db = mongoDatabase(service, { users: usersCol });
const uploadStream = await db.gridfs.openUploadStream("file.txt");
const downloadStream = await db.gridfs.openDownloadStream(fileId);
const files = await db.gridfs.find({ filename: "file.txt" });
await db.gridfs.delete(fileId);
// openUploadStreamWithId, openDownloadStreamByName, drop, rename, etc.
```

## Types

- **`Document`** — Base document type (from mongodb; includes `_id` and typically `id`).
- **`ColDefinition<T>`** / **`colDef<T>({ indexes })`** — Collection definition with optional indexes.
- **`Collection<T>`** — Wrapper type.
- **`mongoCollection<C>`** — Extracts `Collection<T>` from `ColDefinition<T>`.
- **`MongoDatabase<C>`** / **`MongoResult<C>`** — Typed record of collections + `ensureIndexes`, `gridfs`, `withTransaction`.
- **`Substituer`** / **`Substituers`** — Transform types for `in`/`out`.
- **`Indexes`** — `{ spec: IndexSpecification; options?: CreateIndexesOptions }[]`.

Re-exports from `mongodb`: `Filter`, `FindOptions`, `UpdateFilter`, `UpdateOptions`, `DeleteResult`, `UpdateResult`, `FindCursor`, `ObjectId`, `WithoutId`, `OptionalUnlessRequiredId`, and related option types.

## MongoResource (Next.js App Router)

`MongoResource` generates RESTful API route handlers for Next.js App Router. It maps HTTP methods to collection operations with automatic error handling.

### Basic Usage

```ts
// app/api/users/[...resource]/route.ts
import { MongoResource } from "mongo-collections/resource";
import { usersCollection } from "@/db";

export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } =
  MongoResource(usersCollection);
```

### HTTP Methods

| Method    | Route            | Action                                                  |
| --------- | ---------------- | ------------------------------------------------------- |
| `GET`     | `/resource`      | List all documents (with optional filter)               |
| `GET`     | `/resource/:id`  | Get single document by id                               |
| `POST`    | `/resource`      | Create new document                                     |
| `POST`    | `/resource/bulk` | Create multiple documents (array body)                  |
| `PUT`     | `/resource/:id`  | Update document (full replacement)                      |
| `PATCH`   | `/resource/:id`  | Partial update document                                 |
| `DELETE`  | `/resource/:id`  | Delete document                                         |
| `HEAD`    | `/resource/:id`  | Check if document exists (200/404)                      |
| `OPTIONS` | `/resource`      | Returns `Allow: GET, POST, OPTIONS`                     |
| `OPTIONS` | `/resource/:id`  | Returns `Allow: GET, PUT, PATCH, DELETE, HEAD, OPTIONS` |

### Options

```ts
export const { GET, POST, PUT, DELETE } = MongoResource(usersCollection, {
  // Request validation (runs before every handler)
  validateRequest: async (request, resource, method) => {
    const token = request.headers.get("authorization");
    if (!token) throw new BadParametersError("Unauthorized", "users");
  },

  // Parse URL id segment (e.g. string → ObjectId)
  parseId: (id) => new ObjectId(id),

  // Convert search params to MongoDB filter for GET list
  searchParamsToFilter: (params) => {
    const name = params.get("name");
    return name ? { name: { $regex: name, $options: "i" } } : {};
  },

  // Parse/validate request body for updates (PUT/PATCH)
  parsePayload: (payload, col, request) => ({
    name: payload.name?.trim(),
    updatedAt: new Date(),
  }),

  // Parse/validate request body for creation (POST)
  // Supports async for validation against external services
  parseCreationPayload: async (payload, col, request) => {
    const validated = await validateUser(payload);
    return { ...validated, createdAt: new Date() };
  },

  // Custom update filter (default: { $set: payload })
  payloadToUpdate: (payload, col, request) => ({
    $set: { name: payload.name },
    $inc: { version: 1 },
  }),

  // Custom handlers (override default behavior)
  findOne: async (id, col, request) => col.findById(id),
  getAll: async (filter, col, request) => col.find(filter),
  create: async (payload, col, request) => col.insert(payload),
  createBulk: async (payloads, col, request) => {
    await col.insertMany(payloads);
    return payloads;
  },
  update: async (id, payload, col, request) =>
    col.getAndUpdateById(id, { $set: payload }),
  delete: async (id, col, request) => col.deleteById(id),
  exists: async (id, col, request) => col.exists({ id }),

  // Custom error handler
  errorHandler: (error) => {
    if (error instanceof UnauthorizedError) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }
    return defaultErrorHandler(error);
  },
});
```

### Error Handling

The default error handler maps domain errors to HTTP status codes:

| Error                | HTTP Status |
| -------------------- | ----------- |
| `NotFoundError`      | 404         |
| `BadParametersError` | 400         |
| `DuplicateError`     | 409         |
| Other errors         | 500         |

### Bulk Operations

POST to `/resource/bulk` with an array body to create multiple documents:

```ts
// POST /api/users/bulk
// Body: [{ name: "Alice" }, { name: "Bob" }]
```

Each item in the array is processed through `parseCreationPayload` (or `parsePayload`), supporting async validation.

## License

ISC
