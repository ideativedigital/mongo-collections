import test from 'ava'
import { ObjectId } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { colDef } from '../src/col-definition'
import { BadParametersError, DuplicateError, NotFoundError } from '../src/errors/mongo-errors'
import { chainModelMappers, Collection, modelMapper, mongoIdMapper, wrapMongoCollection } from '../src/mongo-collection'
import { mongoDatabase, MongoService } from '../src/mongo-service'
import { substitute } from '../src/utils/substitute'

type TestDoc = { id: string; name: string }

let mongod: MongoMemoryServer
let uri: string
let service: MongoService

test.before(async () => {
  mongod = await MongoMemoryServer.create()
  uri = mongod.getUri()
  service = MongoService.create(uri)
})

test.after(async () => {
  await service?.close()
  await mongod?.stop()
})

function uniqueColName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

test('MongoService.create: getDB returns Db', async (t) => {
  const db = await service.getDB()
  t.truthy(db)
  t.truthy(typeof db.collection === 'function')
})

test('MongoService: nativeCollection returns a collection', async (t) => {
  const col = await service.nativeCollection<TestDoc>(uniqueColName())
  t.truthy(col)
  t.truthy(typeof col.insertOne === 'function')
  t.truthy(typeof col.findOne === 'function')
})

test('MongoService: withTransaction runs and commits', async (t) => {
  let ran = false
  await service.withTransaction(async () => {
    ran = true
  })
  t.true(ran)
})

// ---- wrapMongoCollection tests ----

test('wrapMongoCollection: returns a Collection instance', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  t.true(col instanceof Collection)
})

test('wrapMongoCollection: stores the collection name', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  t.is(col.name, colName)
})

test('wrapMongoCollection: collection can perform operations', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  // Insert and retrieve
  await col.insert({ id: 'wrap1', name: 'Wrapped' })
  const found = await col.findById('wrap1')
  t.truthy(found)
  t.is(found!.name, 'Wrapped')
})

test('wrapMongoCollection: with indexes creates indexes', async (t) => {
  const colName = uniqueColName()
  const indexes = [{ spec: { name: 1 }, options: { unique: true } }] as const
  const col = wrapMongoCollection<TestDoc>(service, colName, [...indexes])

  await col.ensureIndexes()

  // Insert first doc
  await col.insert({ id: 'idx1', name: 'Unique' })

  // Try to insert duplicate name - should throw DuplicateError
  const error = await t.throwsAsync(() => col.insert({ id: 'idx2', name: 'Unique' }))
  t.true(error instanceof DuplicateError)
})

test('wrapMongoCollection: with substituers applies out transform', async (t) => {
  const colName = uniqueColName()
  const out = substitute(
    (x): x is string => typeof x === 'string' && x.startsWith('transform:'),
    (s) => s.replace('transform:', 'OUT:')
  )
  const col = wrapMongoCollection<TestDoc>(service, colName, [], { out })

  await col.insert({ id: 'sub1', name: 'transform:test' })
  const found = await col.findById('sub1')
  t.truthy(found)
  t.is(found!.name, 'OUT:test')
})

test('wrapMongoCollection: with substituers applies in transform', async (t) => {
  const colName = uniqueColName()
  const inSub = substitute(
    (x): x is string => typeof x === 'string' && x.startsWith('search:'),
    (s) => s.replace('search:', '')
  )
  const col = wrapMongoCollection<TestDoc>(service, colName, [], { in: inSub })

  // Insert normally (without substituer, since this is 'in' substituer for filters)
  const nativeCol = await service.nativeCollection<TestDoc>(colName)
  await nativeCol.insertOne({ id: 'insub1', name: 'found' } as any)

  // Search with transformed filter
  const found = await col.findOne({ name: 'search:found' })
  t.truthy(found)
  t.is(found!.id, 'insub1')
})

test('wrapMongoCollection: mapper transforms API model to DB model and back', async (t) => {
  type ApiDoc = { id: string; name: string }
  type DbDoc = { id: string; db_name: string }

  const colName = uniqueColName()
  const mapper = modelMapper<ApiDoc, DbDoc>({
    toDb: (doc) => ({ id: doc.id, db_name: doc.name }),
    toApi: (doc) => ({ id: doc.id, name: doc.db_name }),
    filterToDb: (filter) => {
      const transformed = { ...(filter as any) }
      if ('name' in transformed) {
        transformed.db_name = transformed.name
        delete transformed.name
      }
      return transformed
    },
    updateToDb: (update) => {
      const transformed = { ...(update as any) }
      if (transformed.$set?.name) {
        transformed.$set = { ...transformed.$set, db_name: transformed.$set.name }
        delete transformed.$set.name
      }
      return transformed
    },
  })

  const col = wrapMongoCollection<ApiDoc, DbDoc>(service, colName, [], { mapper })

  await col.insert({ id: 'map1', name: 'Mapped Name' })
  const nativeCol = await service.nativeCollection<DbDoc>(colName)
  const raw = await nativeCol.findOne({ id: 'map1' })
  t.truthy(raw)
  t.is(raw?.db_name, 'Mapped Name')

  const found = await col.findOne({ name: 'Mapped Name' })
  t.truthy(found)
  t.is(found?.name, 'Mapped Name')

  await col.updatebyId('map1', { $set: { name: 'Updated Name' } })
  const updatedRaw = await nativeCol.findOne({ id: 'map1' })
  t.is(updatedRaw?.db_name, 'Updated Name')
})

test('wrapMongoCollection: mongoIdMapper maps id <-> _id automatically', async (t) => {
  type ApiDoc = { id: string; name: string }
  type DbDoc = { _id: ObjectId; name: string }

  const colName = uniqueColName()
  const col = wrapMongoCollection<ApiDoc, DbDoc>(service, colName, [], {
    mapper: mongoIdMapper<ApiDoc, DbDoc>(),
  })

  // Insert API doc (id) and verify stored as _id in Mongo
  const generatedId = new ObjectId().toHexString()
  await col.insert({ id: generatedId, name: 'Alice' })

  const nativeCol = await service.nativeCollection<DbDoc>(colName)
  const raw = await nativeCol.findOne({ _id: new ObjectId(generatedId) })
  t.truthy(raw)
  t.is(raw?.name, 'Alice')

  // Insert native Mongo doc and verify it is exposed as id
  const secondId = new ObjectId()
  await nativeCol.insertOne({ _id: secondId, name: 'Bob' })
  const fromApi = await col.findById(secondId.toHexString())
  t.truthy(fromApi)
  t.is(fromApi?.id, secondId.toHexString())
  t.is(fromApi?.name, 'Bob')
})

test('wrapMongoCollection: chainModelMappers composes mapper layers', async (t) => {
  type ApiDoc = { id: string; name: string }
  type MidDoc = { id: string; fullName: string }
  type DbDoc = { _id: ObjectId; full_name: string }

  const renameMapper = modelMapper<ApiDoc, MidDoc>({
    toDb: (doc) => ({ id: doc.id, fullName: doc.name }),
    toApi: (doc) => ({ id: doc.id, name: doc.fullName }),
    filterToDb: (filter) => {
      const transformed = { ...(filter as any) }
      if ('name' in transformed) {
        transformed.fullName = transformed.name
        delete transformed.name
      }
      return transformed
    },
    updateToDb: (update) => {
      const transformed = { ...(update as any) }
      if (transformed.$set?.name) {
        transformed.$set = { ...transformed.$set, fullName: transformed.$set.name }
        delete transformed.$set.name
      }
      return transformed
    },
  })
  const idMapper = modelMapper<MidDoc, DbDoc>({
    toDb: (doc) => ({ _id: new ObjectId(doc.id), full_name: doc.fullName }),
    toApi: (doc) => ({ id: doc._id.toHexString(), fullName: doc.full_name }),
    filterToDb: (filter) => {
      const transformed = { ...(filter as any) }
      if ('id' in transformed) {
        transformed._id = new ObjectId(String(transformed.id))
        delete transformed.id
      }
      if ('fullName' in transformed) {
        transformed.full_name = transformed.fullName
        delete transformed.fullName
      }
      return transformed
    },
    updateToDb: (update) => {
      const transformed = { ...(update as any) }
      if (transformed.$set?.fullName) {
        transformed.$set = { ...transformed.$set, full_name: transformed.$set.fullName }
        delete transformed.$set.fullName
      }
      return transformed
    },
  })
  const mapper = chainModelMappers(renameMapper, idMapper)

  const colName = uniqueColName()
  const col = wrapMongoCollection<ApiDoc, DbDoc>(service, colName, [], { mapper })

  const id = new ObjectId().toHexString()
  await col.insert({ id, name: 'Layered' })

  const nativeCol = await service.nativeCollection<DbDoc>(colName)
  const raw = await nativeCol.findOne({ _id: new ObjectId(id) })
  t.truthy(raw)
  t.is(raw?.full_name, 'Layered')

  const found = await col.findById(id)
  t.truthy(found)
  t.is(found?.name, 'Layered')

  await col.updatebyId(id, { $set: { name: 'Updated Layered' } })
  const updatedRaw = await nativeCol.findOne({ _id: new ObjectId(id) })
  t.is(updatedRaw?.full_name, 'Updated Layered')
})

test('modelMapper: .and composes mapper layers', async (t) => {
  type ApiDoc = { id: string; name: string }
  type MidDoc = { id: string; fullName: string }
  type DbDoc = { _id: ObjectId; full_name: string }

  const renameMapper = modelMapper<ApiDoc, MidDoc>({
    toDb: (doc) => ({ id: doc.id, fullName: doc.name }),
    toApi: (doc) => ({ id: doc.id, name: doc.fullName }),
    filterToDb: (filter) => {
      const transformed = { ...(filter as any) }
      if ('name' in transformed) {
        transformed.fullName = transformed.name
        delete transformed.name
      }
      return transformed
    },
    updateToDb: (update) => {
      const transformed = { ...(update as any) }
      if (transformed.$set?.name) {
        transformed.$set = { ...transformed.$set, fullName: transformed.$set.name }
        delete transformed.$set.name
      }
      return transformed
    },
  })
  const idMapper = modelMapper<MidDoc, DbDoc>({
    toDb: (doc) => ({ _id: new ObjectId(doc.id), full_name: doc.fullName }),
    toApi: (doc) => ({ id: doc._id.toHexString(), fullName: doc.full_name }),
    filterToDb: (filter) => {
      const transformed = { ...(filter as any) }
      if ('id' in transformed) {
        transformed._id = new ObjectId(String(transformed.id))
        delete transformed.id
      }
      if ('fullName' in transformed) {
        transformed.full_name = transformed.fullName
        delete transformed.fullName
      }
      return transformed
    },
    updateToDb: (update) => {
      const transformed = { ...(update as any) }
      if (transformed.$set?.fullName) {
        transformed.$set = { ...transformed.$set, full_name: transformed.$set.fullName }
        delete transformed.$set.fullName
      }
      return transformed
    },
  })
  const mapper = renameMapper.and(idMapper)

  const colName = uniqueColName()
  const col = wrapMongoCollection<ApiDoc, DbDoc>(service, colName, [], { mapper })

  const id = new ObjectId().toHexString()
  await col.insert({ id, name: 'Chained' })

  const nativeCol = await service.nativeCollection<DbDoc>(colName)
  const raw = await nativeCol.findOne({ _id: new ObjectId(id) })
  t.truthy(raw)
  t.is(raw?.full_name, 'Chained')
})

test('wrapMongoCollection: default empty indexes and substituers', async (t) => {
  const colName = uniqueColName()
  // Call with minimal args
  const col = wrapMongoCollection<TestDoc>(service, colName)

  // Should still work
  await col.insert({ id: 'def1', name: 'Default' })
  const found = await col.findById('def1')
  t.truthy(found)
  t.is(found!.name, 'Default')
})

// ---- Collection tests ----

test('Collection: insert then findById returns document', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  const doc = { id: 'a1', name: 'Alice' }
  const inserted = await col.insert(doc)
  t.is(inserted.id, 'a1')
  t.is(inserted.name, 'Alice')

  const found = await col.findById('a1')
  t.truthy(found)
  t.is(found!.id, 'a1')
  t.is(found!.name, 'Alice')

  const got = await col.getById('a1')
  t.is(got.id, 'a1')
})

test('Collection: findOne with no match returns null', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, uniqueColName(), [])
  const found = await col.findOne({ name: 'nonexistent' })
  t.is(found, null)
})

test('Collection: getById with missing id throws NotFoundError', async (t) => {
  const col = wrapMongoCollection<TestDoc>(service, uniqueColName(), [])
  await t.throwsAsync(() => col.getById('nope'), { instanceOf: NotFoundError })
})

test('Collection: getOne with no match throws BadParametersError', async (t) => {
  const col = wrapMongoCollection<TestDoc>(service, uniqueColName(), [])
  const err = await t.throwsAsync(() => col.getOne({ name: 'x' }))
  t.true(err instanceof BadParametersError)
})

test('Collection: updateOne then findById sees change', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'u1', name: 'Before' })
  await col.updateOne({ id: 'u1' }, { $set: { name: 'After' } })

  const found = await col.findById('u1')
  t.is(found?.name, 'After')
})

test('Collection: updatebyId updates by id', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'uid1', name: 'Before' })
  await col.updatebyId('uid1', { $set: { name: 'After' } })

  const found = await col.findById('uid1')
  t.is(found?.name, 'After')
})

test('Collection: deleteById removes by id', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'd1', name: 'ToDelete' })
  await col.deleteById('d1')

  const found = await col.findById('d1')
  t.is(found, null)
})

test('Collection: find and cursor return multiple docs', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'f1', name: 'First' })
  await col.insert({ id: 'f2', name: 'Second' })

  const all = await col.find({})
  t.is(all.length, 2)
})

test('Collection: deleteOne removes document', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'do1', name: 'ToDelete' })
  await col.deleteOne({ id: 'do1' })

  const found = await col.findById('do1')
  t.is(found, null)
})

type DocWithEmail = TestDoc & { email: string }

test('Collection: DuplicateError on duplicate key', async (t) => {
  const colName = uniqueColName()
  const indexes = [{ spec: { email: 1 }, options: { unique: true } }]
  const col = wrapMongoCollection<DocWithEmail>(service, colName, indexes)
  await col.ensureIndexes()

  await col.insert({ id: 'dup1', name: 'A', email: 'a@b.com' })
  const error = await t.throwsAsync(() =>
    col.insert({ id: 'dup2', name: 'B', email: 'a@b.com' })
  )
  t.true(error instanceof DuplicateError)
})

test('Collection: substituer out transforms documents when reading', async (t) => {
  const colName = uniqueColName()
  const out = substitute(
    (x): x is string => typeof x === 'string' && x.startsWith('prefix:'),
    (s) => s.replace('prefix:', '')
  )
  const col = wrapMongoCollection<TestDoc>(service, colName, [], { out })

  await col.insert({ id: 'so1', name: 'prefix:Value' })
  const found = await col.findById('so1')
  t.truthy(found)
  t.is(found!.name, 'Value')
})

test('Collection: substituer in transforms filter when querying', async (t) => {
  const colName = uniqueColName()
  const inSub = substitute(
    (x): x is string => typeof x === 'string' && x.startsWith('query:'),
    (s) => s.replace('query:', '')
  )
  const col = wrapMongoCollection<TestDoc>(service, colName, [], { in: inSub })

  // Insert with native driver (no substituer applied)
  const nativeCol = await service.nativeCollection<TestDoc>(colName)
  await nativeCol.insertOne({ id: 'si1', name: 'findme' } as any)

  const found = await col.findOne({ name: 'query:findme' })
  t.truthy(found)
  t.is(found!.id, 'si1')
})

test('Collection: count and exists', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'ce1', name: 'A' })
  await col.insert({ id: 'ce2', name: 'B' })

  const count = await col.count({})
  t.is(count, 2)

  const exists = await col.exists({ id: 'ce1' })
  t.true(exists)

  const notExists = await col.exists({ id: 'ce99' })
  t.false(notExists)
})

test('mongoDatabase: returns collections, ensureIndexes, withTransaction, gridfs', async (t) => {
  const db = mongoDatabase(service, {
    testCol: colDef<TestDoc>(),
  })

  t.truthy(db.testCol)
  t.truthy(typeof db.ensureIndexes === 'function')
  t.truthy(typeof db.withTransaction === 'function')
  t.truthy(db.gridfs)
})
