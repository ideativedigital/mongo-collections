import test from 'ava'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { BadParametersError, DuplicateError, NotFoundError } from '../src/errors/mongo-errors'
import { modelMapper, wrapMongoCollection } from '../src/mongo-collection'
import { MongoService } from '../src/mongo-service'
import { defaultErrorHandler, MongoResource } from '../src/resource/mongo-resource'

// Mock NextRequest for testing
class MockNextRequest {
  private _body: any
  nextUrl: { searchParams: URLSearchParams }

  constructor(url: string, options?: { method?: string; body?: any }) {
    this.nextUrl = { searchParams: new URL(url, 'http://localhost').searchParams }
    this._body = options?.body
  }

  async json() {
    return this._body
  }
}

// Helper to extract status and data from Response (works with real NextResponse)
async function parseResponse(res: Response | any): Promise<{ status: number; data: any }> {
  const status = res.status ?? res._status ?? 200
  let data: any
  if (typeof res.json === 'function') {
    try {
      data = await res.json()
    } catch {
      data = null
    }
  } else {
    data = res._data ?? null
  }
  return { status, data }
}

type TestDoc = { id: string; name: string; count?: number; extra?: string }

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

// Helper to call a handler with mocked params
async function callHandler(
  handler: (req: any, params: any) => Promise<any>,
  url: string,
  resource: string[],
  body?: any
) {
  const request = new MockNextRequest(url, { body })
  const params = { resource: Promise.resolve(resource) }
  return handler(request, params)
}

// ---- defaultErrorHandler tests ----

test('defaultErrorHandler: NotFoundError returns 404', async (t) => {
  const err = new NotFoundError('item', 'items')
  const res = defaultErrorHandler(err)
  const { status, data } = await parseResponse(res)
  t.is(status, 404)
  t.deepEqual(data, { error: err.message })
})

test('defaultErrorHandler: BadParametersError returns 400', async (t) => {
  const err = new BadParametersError('invalid', 'items')
  const res = defaultErrorHandler(err)
  const { status, data } = await parseResponse(res)
  t.is(status, 400)
  t.deepEqual(data, { error: err.message })
})

test('defaultErrorHandler: DuplicateError returns 409', async (t) => {
  const err = new DuplicateError('item', 'items')
  const res = defaultErrorHandler(err)
  const { status, data } = await parseResponse(res)
  t.is(status, 409)
  t.deepEqual(data, { error: err.message })
})

test('defaultErrorHandler: unknown error returns 500', async (t) => {
  const err = new Error('oops')
  const res = defaultErrorHandler(err)
  const { status, data } = await parseResponse(res)
  t.is(status, 500)
  t.deepEqual(data, { error: 'Internal Server Error' })
})

// ---- MongoResource GET tests ----

test('MongoResource GET: list all documents', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: '1', name: 'Alice' })
  await col.insert({ id: '2', name: 'Bob' })

  const { GET } = MongoResource(col)
  const res = await callHandler(GET, 'http://localhost/api/items', [])
  const { data } = await parseResponse(res)

  t.is(data.length, 2)
  t.truthy(data.find((d: TestDoc) => d.name === 'Alice'))
  t.truthy(data.find((d: TestDoc) => d.name === 'Bob'))
})

test('MongoResource GET: single document by id', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'g1', name: 'GetMe' })

  const { GET } = MongoResource(col)
  const res = await callHandler(GET, 'http://localhost/api/items/g1', ['g1'])
  const { data } = await parseResponse(res)

  t.is(data.id, 'g1')
  t.is(data.name, 'GetMe')
})

test('MongoResource GET: single document not found returns 404', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  const { GET } = MongoResource(col)
  const res = await callHandler(GET, 'http://localhost/api/items/missing', ['missing'])
  const { status } = await parseResponse(res)

  t.is(status, 404)
})

test('MongoResource GET: searchParamsToFilter applies filter', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'f1', name: 'Foo' })
  await col.insert({ id: 'f2', name: 'Bar' })

  const { GET } = MongoResource(col, {
    searchParamsToFilter: (params) => {
      const name = params.get('name')
      return name ? { name } : {}
    },
  })

  const res = await callHandler(GET, 'http://localhost/api/items?name=Foo', [])
  const { data } = await parseResponse(res)

  t.is(data.length, 1)
  t.is(data[0].name, 'Foo')
})

// ---- MongoResource POST tests ----

test('MongoResource POST: create single document', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  const { POST } = MongoResource(col)
  const res = await callHandler(POST, 'http://localhost/api/items', [], { id: 'p1', name: 'Posted' })
  const { data } = await parseResponse(res)

  t.is(data.id, 'p1')
  t.is(data.name, 'Posted')

  const found = await col.findById('p1')
  t.truthy(found)
  t.is(found!.name, 'Posted')
})

test('MongoResource POST: returns 404 if id segment present', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  const { POST } = MongoResource(col)
  const res = await callHandler(POST, 'http://localhost/api/items/123', ['123'], { id: 'x', name: 'X' })
  const { status } = await parseResponse(res)

  t.is(status, 404)
})

test('MongoResource POST bulk: create multiple documents', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  const { POST } = MongoResource(col)
  const docs = [
    { id: 'b1', name: 'Bulk1' },
    { id: 'b2', name: 'Bulk2' },
  ]
  const res = await callHandler(POST, 'http://localhost/api/items/bulk', ['bulk'], docs)
  const { data } = await parseResponse(res)

  t.truthy(data)
  const all = await col.find({})
  t.is(all.length, 2)
  t.truthy(all.find((d) => d.id === 'b1'))
  t.truthy(all.find((d) => d.id === 'b2'))
})

test('MongoResource POST bulk: returns 400 if body is not an array', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  const { POST } = MongoResource(col)
  const res = await callHandler(POST, 'http://localhost/api/items/bulk', ['bulk'], { id: 'x', name: 'X' })
  const { status, data } = await parseResponse(res)

  t.is(status, 400)
  t.true(data.error.includes('array'))
})

test('MongoResource POST: parseCreationPayload is used', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  const { POST } = MongoResource(col, {
    parseCreationPayload: (payload) => ({ ...payload, name: payload.name.toUpperCase() }),
  })
  await callHandler(POST, 'http://localhost/api/items', [], { id: 'pc1', name: 'lower' })

  const found = await col.findById('pc1')
  t.is(found!.name, 'LOWER')
})

test('MongoResource POST: async parseCreationPayload is awaited', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  const { POST } = MongoResource(col, {
    parseCreationPayload: async (payload) => {
      // Simulate async operation (e.g. validation, fetching related data)
      await new Promise((resolve) => setTimeout(resolve, 10))
      return { ...payload, name: `async-${payload.name}` }
    },
  })
  await callHandler(POST, 'http://localhost/api/items', [], { id: 'apc1', name: 'test' })

  const found = await col.findById('apc1')
  t.is(found!.name, 'async-test')
})

test('MongoResource POST bulk: async parseCreationPayload is awaited for each item', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  let callOrder: string[] = []
  const { POST } = MongoResource(col, {
    parseCreationPayload: async (payload) => {
      // Simulate async operation with varying delays
      const delay = payload.id === 'ab1' ? 20 : 5
      await new Promise((resolve) => setTimeout(resolve, delay))
      callOrder.push(payload.id)
      return { ...payload, name: `async-${payload.name}` }
    },
  })

  const docs = [
    { id: 'ab1', name: 'First' },
    { id: 'ab2', name: 'Second' },
  ]
  await callHandler(POST, 'http://localhost/api/items/bulk', ['bulk'], docs)

  const all = await col.find({})
  t.is(all.length, 2)
  t.truthy(all.find((d) => d.name === 'async-First'))
  t.truthy(all.find((d) => d.name === 'async-Second'))
  // Both should have been processed (order may vary due to Promise.all)
  t.is(callOrder.length, 2)
})

// ---- MongoResource PUT tests ----

test('MongoResource PUT: update document by id', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'u1', name: 'Before' })

  const { PUT } = MongoResource(col)
  // PUT uses $set internally, so just pass the fields to update
  await callHandler(PUT, 'http://localhost/api/items/u1', ['u1'], { name: 'After' })

  const found = await col.findById('u1')
  t.is(found!.name, 'After')
})

test('MongoResource PUT: returns 405 if no id segment', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  const { PUT } = MongoResource(col)
  const res = await callHandler(PUT, 'http://localhost/api/items', [], { name: 'X' })
  const { status } = await parseResponse(res)

  t.is(status, 405)
})

test('MongoResource PUT: returns 404 if extra segments', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  const { PUT } = MongoResource(col)
  const res = await callHandler(PUT, 'http://localhost/api/items/a/b', ['a', 'b'], { name: 'X' })
  const { status } = await parseResponse(res)

  t.is(status, 404)
})

test('MongoResource PUT: parsePayload is used', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'pp1', name: 'Original' })

  const { PUT } = MongoResource(col, {
    parsePayload: (payload) => ({ name: payload.name.toUpperCase() }),
  })
  await callHandler(PUT, 'http://localhost/api/items/pp1', ['pp1'], { name: 'changed' })

  const found = await col.findById('pp1')
  t.is(found!.name, 'CHANGED')
})

test('MongoResource PUT: payloadToUpdate customizes update filter', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'ptu1', name: 'Original', count: 5 })

  const { PUT } = MongoResource(col, {
    payloadToUpdate: (payload) => ({ $set: { name: payload.name }, $inc: { count: 1 } }),
  })
  await callHandler(PUT, 'http://localhost/api/items/ptu1', ['ptu1'], { name: 'Updated' })

  const found = await col.findById('ptu1')
  t.is(found!.name, 'Updated')
  t.is(found!.count, 6)
})

test('MongoResource PUT: payloadToUpdate with $unset', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'ptu2', name: 'Original', extra: 'toRemove' })

  const { PUT } = MongoResource(col, {
    payloadToUpdate: (payload) => ({ $set: { name: payload.name }, $unset: { extra: '' as const } }),
  })
  await callHandler(PUT, 'http://localhost/api/items/ptu2', ['ptu2'], { name: 'Updated' })

  const found = await col.findById('ptu2')
  t.is(found!.name, 'Updated')
  t.is(found!.extra, undefined)
})

test('MongoResource PUT: parsePayload and payloadToUpdate work together', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'ptu3', name: 'Original', count: 10 })

  const { PUT } = MongoResource(col, {
    parsePayload: (payload) => ({ name: payload.name.toUpperCase() }),
    payloadToUpdate: (payload) => ({ $set: { name: payload.name }, $inc: { count: -1 } }),
  })
  await callHandler(PUT, 'http://localhost/api/items/ptu3', ['ptu3'], { name: 'changed' })

  const found = await col.findById('ptu3')
  t.is(found!.name, 'CHANGED')
  t.is(found!.count, 9)
})

test('MongoResource PUT: default update uses collection mapper for API -> DB conversion', async (t) => {
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
  await col.insert({ id: 'map-put-1', name: 'Before' })

  const { PUT } = MongoResource(col)
  await callHandler(PUT, 'http://localhost/api/items/map-put-1', ['map-put-1'], { name: 'After' })

  const nativeCol = await service.nativeCollection<DbDoc>(colName)
  const raw = await nativeCol.findOne({ id: 'map-put-1' })
  t.truthy(raw)
  t.is(raw?.db_name, 'After')
})

// ---- MongoResource DELETE tests ----

test('MongoResource DELETE: delete document by id', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'd1', name: 'ToDelete' })

  const { DELETE } = MongoResource(col)
  await callHandler(DELETE, 'http://localhost/api/items/d1', ['d1'])

  const found = await col.findById('d1')
  t.is(found, null)
})

test('MongoResource DELETE: returns 405 if no id segment', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  const { DELETE } = MongoResource(col)
  const res = await callHandler(DELETE, 'http://localhost/api/items', [])
  const { status } = await parseResponse(res)

  t.is(status, 405)
})

test('MongoResource DELETE: returns 404 if extra segments', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  const { DELETE } = MongoResource(col)
  const res = await callHandler(DELETE, 'http://localhost/api/items/a/b', ['a', 'b'])
  const { status } = await parseResponse(res)

  t.is(status, 404)
})

// ---- MongoResource PATCH tests ----

test('MongoResource PATCH: update document by id', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'patch1', name: 'Before' })

  const { PATCH } = MongoResource(col)
  await callHandler(PATCH, 'http://localhost/api/items/patch1', ['patch1'], { name: 'After' })

  const found = await col.findById('patch1')
  t.is(found!.name, 'After')
})

test('MongoResource PATCH: returns 405 if no id segment', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  const { PATCH } = MongoResource(col)
  const res = await callHandler(PATCH, 'http://localhost/api/items', [], { name: 'X' })
  const { status } = await parseResponse(res)

  t.is(status, 405)
})

test('MongoResource PATCH: returns 404 if extra segments', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  const { PATCH } = MongoResource(col)
  const res = await callHandler(PATCH, 'http://localhost/api/items/a/b', ['a', 'b'], { name: 'X' })
  const { status } = await parseResponse(res)

  t.is(status, 404)
})

test('MongoResource PATCH: parsePayload is used', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'patchpp1', name: 'Original' })

  const { PATCH } = MongoResource(col, {
    parsePayload: (payload) => ({ name: payload.name.toUpperCase() }),
  })
  await callHandler(PATCH, 'http://localhost/api/items/patchpp1', ['patchpp1'], { name: 'changed' })

  const found = await col.findById('patchpp1')
  t.is(found!.name, 'CHANGED')
})

test('MongoResource PATCH: payloadToUpdate customizes update filter', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'patchptu1', name: 'Original', count: 5 })

  const { PATCH } = MongoResource(col, {
    payloadToUpdate: (payload) => ({ $set: { name: payload.name }, $inc: { count: 1 } }),
  })
  await callHandler(PATCH, 'http://localhost/api/items/patchptu1', ['patchptu1'], { name: 'Updated' })

  const found = await col.findById('patchptu1')
  t.is(found!.name, 'Updated')
  t.is(found!.count, 6)
})

test('MongoResource PATCH: payloadToUpdate with $unset', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'patchptu2', name: 'Original', extra: 'toRemove' })

  const { PATCH } = MongoResource(col, {
    payloadToUpdate: (payload) => ({ $set: { name: payload.name }, $unset: { extra: '' as const } }),
  })
  await callHandler(PATCH, 'http://localhost/api/items/patchptu2', ['patchptu2'], { name: 'Updated' })

  const found = await col.findById('patchptu2')
  t.is(found!.name, 'Updated')
  t.is(found!.extra, undefined)
})

test('MongoResource PATCH: parsePayload and payloadToUpdate work together', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'patchptu3', name: 'Original', count: 10 })

  const { PATCH } = MongoResource(col, {
    parsePayload: (payload) => ({ name: payload.name.toUpperCase() }),
    payloadToUpdate: (payload) => ({ $set: { name: payload.name }, $inc: { count: -1 } }),
  })
  await callHandler(PATCH, 'http://localhost/api/items/patchptu3', ['patchptu3'], { name: 'changed' })

  const found = await col.findById('patchptu3')
  t.is(found!.name, 'CHANGED')
  t.is(found!.count, 9)
})

// ---- MongoResource HEAD tests ----

test('MongoResource HEAD: returns 200 if document exists', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'head1', name: 'Exists' })

  const { HEAD } = MongoResource(col)
  const res = await callHandler(HEAD, 'http://localhost/api/items/head1', ['head1'])
  const { status } = await parseResponse(res)

  t.is(status, 200)
})

test('MongoResource HEAD: returns 404 if document does not exist', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  const { HEAD } = MongoResource(col)
  const res = await callHandler(HEAD, 'http://localhost/api/items/nonexistent', ['nonexistent'])
  const { status } = await parseResponse(res)

  t.is(status, 404)
})

test('MongoResource HEAD: returns 405 if no id segment', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  const { HEAD } = MongoResource(col)
  const res = await callHandler(HEAD, 'http://localhost/api/items', [])
  const { status } = await parseResponse(res)

  t.is(status, 405)
})

test('MongoResource HEAD: returns 404 if extra segments', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  const { HEAD } = MongoResource(col)
  const res = await callHandler(HEAD, 'http://localhost/api/items/a/b', ['a', 'b'])
  const { status } = await parseResponse(res)

  t.is(status, 404)
})

test('MongoResource HEAD: custom exists handler is used', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'headcustom1', name: 'Exists' })

  let checkedId: unknown = ''
  const { HEAD } = MongoResource(col, {
    exists: async (id) => {
      checkedId = id
      return id === 'headcustom1'
    },
  })

  const res = await callHandler(HEAD, 'http://localhost/api/items/headcustom1', ['headcustom1'])
  const { status } = await parseResponse(res)

  t.is(status, 200)
  t.is(String(checkedId), 'headcustom1')

  // Test custom exists returning false
  const res2 = await callHandler(HEAD, 'http://localhost/api/items/other', ['other'])
  const { status: status2 } = await parseResponse(res2)
  t.is(status2, 404)
})

// ---- MongoResource OPTIONS tests ----

test('MongoResource OPTIONS: returns allowed methods for collection root', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  const { OPTIONS } = MongoResource(col)
  const res = await callHandler(OPTIONS, 'http://localhost/api/items', [])
  const { status } = await parseResponse(res)

  t.is(status, 204)
  t.is(res.headers.get('Allow'), 'GET, POST, OPTIONS')
})

test('MongoResource OPTIONS: returns allowed methods for single resource', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  const { OPTIONS } = MongoResource(col)
  const res = await callHandler(OPTIONS, 'http://localhost/api/items/123', ['123'])
  const { status } = await parseResponse(res)

  t.is(status, 204)
  t.is(res.headers.get('Allow'), 'GET, PUT, PATCH, DELETE, HEAD, OPTIONS')
})

test('MongoResource OPTIONS: returns 404 if extra segments', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  const { OPTIONS } = MongoResource(col)
  const res = await callHandler(OPTIONS, 'http://localhost/api/items/a/b', ['a', 'b'])
  const { status } = await parseResponse(res)

  t.is(status, 404)
})

// ---- Custom options tests ----

test('MongoResource: parseId transforms id before use', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'ID-123', name: 'Parsed' })

  const { GET } = MongoResource(col, {
    parseId: (id) => `ID-${id}`,
  })
  const res = await callHandler(GET, 'http://localhost/api/items/123', ['123'])
  const { data } = await parseResponse(res)

  t.is(data.id, 'ID-123')
  t.is(data.name, 'Parsed')
})

test('MongoResource: custom errorHandler is called on error', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  let capturedError: unknown = null
  const { GET } = MongoResource(col, {
    errorHandler: (error) => {
      capturedError = error
      return new Response(JSON.stringify({ custom: 'error' }), {
        status: 418,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  })

  const res = await callHandler(GET, 'http://localhost/api/items/nope', ['nope'])
  const { status, data } = await parseResponse(res)

  t.is(status, 418)
  t.deepEqual(data, { custom: 'error' })
  t.true(capturedError instanceof NotFoundError)
})

// ---- validateRequest tests ----

test('MongoResource: validateRequest is called with correct parameters for GET', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'vr1', name: 'Test' })

  let capturedRequest: any = null
  let capturedResource: string[] = []
  let capturedMethod = ''

  const { GET } = MongoResource(col, {
    validateRequest: async (request, resource, method) => {
      capturedRequest = request
      capturedResource = resource
      capturedMethod = method
    },
  })

  await callHandler(GET, 'http://localhost/api/items/vr1', ['vr1'])

  t.truthy(capturedRequest)
  t.deepEqual(capturedResource, ['vr1'])
  t.is(capturedMethod, 'GET')
})

test('MongoResource: validateRequest is called for POST', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  let capturedMethod = ''
  let capturedResource: string[] = []

  const { POST } = MongoResource(col, {
    validateRequest: async (request, resource, method) => {
      capturedMethod = method
      capturedResource = resource
    },
  })

  await callHandler(POST, 'http://localhost/api/items', [], { id: 'vr2', name: 'Test' })

  t.is(capturedMethod, 'POST')
  t.deepEqual(capturedResource, [])
})

test('MongoResource: validateRequest is called for PUT', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'vr3', name: 'Before' })

  let capturedMethod = ''
  let capturedResource: string[] = []

  const { PUT } = MongoResource(col, {
    validateRequest: async (request, resource, method) => {
      capturedMethod = method
      capturedResource = resource
    },
  })

  await callHandler(PUT, 'http://localhost/api/items/vr3', ['vr3'], { name: 'After' })

  t.is(capturedMethod, 'PUT')
  t.deepEqual(capturedResource, ['vr3'])
})

test('MongoResource: validateRequest is called for PATCH', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'vr4', name: 'Before' })

  let capturedMethod = ''
  let capturedResource: string[] = []

  const { PATCH } = MongoResource(col, {
    validateRequest: async (request, resource, method) => {
      capturedMethod = method
      capturedResource = resource
    },
  })

  await callHandler(PATCH, 'http://localhost/api/items/vr4', ['vr4'], { name: 'After' })

  t.is(capturedMethod, 'PATCH')
  t.deepEqual(capturedResource, ['vr4'])
})

test('MongoResource: validateRequest is called for DELETE', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'vr5', name: 'ToDelete' })

  let capturedMethod = ''
  let capturedResource: string[] = []

  const { DELETE } = MongoResource(col, {
    validateRequest: async (request, resource, method) => {
      capturedMethod = method
      capturedResource = resource
    },
  })

  await callHandler(DELETE, 'http://localhost/api/items/vr5', ['vr5'])

  t.is(capturedMethod, 'DELETE')
  t.deepEqual(capturedResource, ['vr5'])
})

test('MongoResource: validateRequest is called for HEAD', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'vr6', name: 'Exists' })

  let capturedMethod = ''
  let capturedResource: string[] = []

  const { HEAD } = MongoResource(col, {
    validateRequest: async (request, resource, method) => {
      capturedMethod = method
      capturedResource = resource
    },
  })

  await callHandler(HEAD, 'http://localhost/api/items/vr6', ['vr6'])

  t.is(capturedMethod, 'HEAD')
  t.deepEqual(capturedResource, ['vr6'])
})

test('MongoResource: validateRequest is called for OPTIONS', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  let capturedMethod = ''
  let capturedResource: string[] = []

  const { OPTIONS } = MongoResource(col, {
    validateRequest: async (request, resource, method) => {
      capturedMethod = method
      capturedResource = resource
    },
  })

  await callHandler(OPTIONS, 'http://localhost/api/items', [])

  t.is(capturedMethod, 'OPTIONS')
  t.deepEqual(capturedResource, [])
})

test('MongoResource: validateRequest throwing error returns error response', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'vr7', name: 'Test' })

  const { GET } = MongoResource(col, {
    validateRequest: async () => {
      throw new BadParametersError('Validation failed', col.name)
    },
  })

  const res = await callHandler(GET, 'http://localhost/api/items/vr7', ['vr7'])
  const { status, data } = await parseResponse(res)

  t.is(status, 400)
  t.true(data.error.includes('Validation failed'))
})

test('MongoResource: validateRequest can block DELETE while allowing GET', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'vr8', name: 'Test' })

  const { DELETE } = MongoResource(col, {
    validateRequest: async (request, resource, method) => {
      if (method === 'DELETE') {
        throw new BadParametersError('DELETE not allowed', col.name)
      }
    },
  })

  // DELETE should be blocked by validateRequest
  const deleteRes = await callHandler(DELETE, 'http://localhost/api/items/vr8', ['vr8'])
  const { status: deleteStatus } = await parseResponse(deleteRes)
  t.is(deleteStatus, 400)

  // Document should still exist since DELETE was blocked
  const found = await col.findById('vr8')
  t.truthy(found)
})

test('MongoResource: validateRequest with custom errorHandler', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  const { GET } = MongoResource(col, {
    validateRequest: async () => {
      throw new Error('Auth failed')
    },
    errorHandler: (error) => {
      if (error instanceof Error && error.message === 'Auth failed') {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ error: 'Unknown error' }), { status: 500 })
    },
  })

  const res = await callHandler(GET, 'http://localhost/api/items', [])
  const { status, data } = await parseResponse(res)

  t.is(status, 401)
  t.deepEqual(data, { error: 'Unauthorized' })
})

// ---- wrapper option tests ----

test('MongoResource: wrapper wraps the handler function', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'wrap1', name: 'Wrapped' })

  let wrapperCalled = false
  const { GET } = MongoResource(col, {
    wrapper: (fn) => async (request, params) => {
      wrapperCalled = true
      return fn(request, params)
    },
  })

  const res = await callHandler(GET, 'http://localhost/api/items/wrap1', ['wrap1'])
  const { status, data } = await parseResponse(res)

  t.true(wrapperCalled)
  t.is(status, 200)
  t.is(data.name, 'Wrapped')
})

test('MongoResource: wrapper can modify the response', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'wrap2', name: 'Original' })

  const { GET } = MongoResource(col, {
    wrapper: (fn) => async (request, params) => {
      const response = await fn(request, params)
      // Add a custom header to the response
      const newResponse = new Response(response.body, {
        status: response.status,
        headers: {
          ...Object.fromEntries(response.headers.entries()),
          'X-Custom-Header': 'wrapped',
        },
      })
      return newResponse
    },
  })

  const res = await callHandler(GET, 'http://localhost/api/items/wrap2', ['wrap2'])

  t.is(res.headers.get('X-Custom-Header'), 'wrapped')
})

test('MongoResource: wrapper can short-circuit the request', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'wrap3', name: 'ShouldNotBeReturned' })

  let handlerCalled = false
  const { GET } = MongoResource(col, {
    wrapper: (fn) => async (request, params) => {
      // Short-circuit: return early without calling the handler
      return new Response(JSON.stringify({ intercepted: true }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    },
    findOne: async () => {
      handlerCalled = true
      return null
    },
  })

  const res = await callHandler(GET, 'http://localhost/api/items/wrap3', ['wrap3'])
  const { status, data } = await parseResponse(res)

  t.false(handlerCalled)
  t.is(status, 403)
  t.deepEqual(data, { intercepted: true })
})

test('MongoResource: wrapper receives correct request and params', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'wrap4', name: 'Test' })

  let capturedFoo = ''
  let capturedResource: string[] = []

  const { GET } = MongoResource(col, {
    wrapper: (fn) => async (request, params) => {
      capturedFoo = request.nextUrl.searchParams.get('foo') || ''
      capturedResource = await params.resource
      return fn(request, params)
    },
  })

  await callHandler(GET, 'http://localhost/api/items/wrap4?foo=bar', ['wrap4'])

  t.is(capturedFoo, 'bar')
  t.deepEqual(capturedResource, ['wrap4'])
})

test('MongoResource: wrapper is applied to all HTTP methods', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'wrap5', name: 'Test' })

  const methodsCalled: string[] = []
  const wrapperOption = {
    wrapper: (fn: any) => async (request: any, params: any) => {
      // We can't easily detect which method is being called from here,
      // but we can verify the wrapper is invoked
      methodsCalled.push('called')
      return fn(request, params)
    },
  }

  const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = MongoResource(col, wrapperOption)

  // Call each method
  await callHandler(GET, 'http://localhost/api/items', [])
  await callHandler(POST, 'http://localhost/api/items', [], { id: 'wrap6', name: 'New' })
  await callHandler(PUT, 'http://localhost/api/items/wrap5', ['wrap5'], { name: 'Updated' })
  await callHandler(PATCH, 'http://localhost/api/items/wrap5', ['wrap5'], { name: 'Patched' })
  await callHandler(DELETE, 'http://localhost/api/items/wrap5', ['wrap5'])
  await callHandler(HEAD, 'http://localhost/api/items/wrap6', ['wrap6'])
  await callHandler(OPTIONS, 'http://localhost/api/items', [])

  t.is(methodsCalled.length, 7)
})

test('MongoResource: wrapper can add timing/logging', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'wrap7', name: 'Timed' })

  let duration = 0
  const { GET } = MongoResource(col, {
    wrapper: (fn) => async (request, params) => {
      const start = Date.now()
      const response = await fn(request, params)
      duration = Date.now() - start
      return response
    },
  })

  await callHandler(GET, 'http://localhost/api/items/wrap7', ['wrap7'])

  t.true(duration >= 0) // Duration was captured
})

test('MongoResource: custom findOne handler is used', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'fo1', name: 'FindOneCustom' })

  const { GET } = MongoResource(col, {
    findOne: async (id, c) => {
      const doc = await c.findById(String(id))
      return doc ? { ...doc, name: doc.name + '-custom' } : null
    },
  })
  const res = await callHandler(GET, 'http://localhost/api/items/fo1', ['fo1'])
  const { data } = await parseResponse(res)

  t.is(data.name, 'FindOneCustom-custom')
})

test('MongoResource: custom getAll handler is used', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'ga1', name: 'GetAll1' })
  await col.insert({ id: 'ga2', name: 'GetAll2' })

  const { GET } = MongoResource(col, {
    getAll: async (filter, c) => {
      const docs = await c.find(filter)
      return docs.map((d) => ({ ...d, name: d.name + '-all' }))
    },
  })
  const res = await callHandler(GET, 'http://localhost/api/items', [])
  const { data } = await parseResponse(res)

  t.true(data.every((d: TestDoc) => d.name.endsWith('-all')))
})

test('MongoResource: custom create handler is used', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])

  const { POST } = MongoResource(col, {
    create: async (payload, c) => {
      const doc = { ...payload, name: payload.name + '-created' } as TestDoc
      return c.insert(doc)
    },
  })
  await callHandler(POST, 'http://localhost/api/items', [], { id: 'cc1', name: 'Custom' })

  const found = await col.findById('cc1')
  t.is(found!.name, 'Custom-created')
})

test('MongoResource: custom update handler is used', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'cu1', name: 'Original' })

  const { PUT } = MongoResource(col, {
    update: async (id, payload, c) => {
      const castedId = String(id)
      await c.updatebyId(castedId, { $set: { name: 'CustomUpdate' } })
      return (await c.getById(castedId)) as TestDoc
    },
  })
  await callHandler(PUT, 'http://localhost/api/items/cu1', ['cu1'], { name: 'ignored' })

  const found = await col.findById('cu1')
  t.is(found!.name, 'CustomUpdate')
})

test('MongoResource: custom delete handler is used', async (t) => {
  const colName = uniqueColName()
  const col = wrapMongoCollection<TestDoc>(service, colName, [])
  await col.insert({ id: 'cd1', name: 'ToDelete' })

  let deletedId: unknown = null
  const { DELETE } = MongoResource(col, {
    delete: async (id, c) => {
      deletedId = id
      await c.deleteById(String(id))
    },
  })
  await callHandler(DELETE, 'http://localhost/api/items/cd1', ['cd1'])

  t.is(String(deletedId), 'cd1')
  const found = await col.findById('cd1')
  t.is(found, null)
})
