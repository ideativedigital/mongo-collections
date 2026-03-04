import test from 'ava'
import { colDef, ColDefinition } from '../src/col-definition'

test('colDef with no args returns ColDefinition with empty indexes', (t) => {
  const def = colDef()
  t.true(def instanceof ColDefinition)
  t.deepEqual(def.indexes, [])
})

test('colDef with empty object returns ColDefinition with empty indexes', (t) => {
  const def = colDef({})
  t.true(def instanceof ColDefinition)
  t.deepEqual(def.indexes, [])
})

test('colDef with indexes returns ColDefinition with that indexes array', (t) => {
  const indexes = [{ spec: { email: 1 }, options: { unique: true } }]
  const def = colDef<{ email: string }>({ indexes })
  t.true(def instanceof ColDefinition)
  t.is(def.indexes.length, 1)
  t.deepEqual(def.indexes[0].spec, { email: 1 })
  t.deepEqual(def.indexes[0].options, { unique: true })
})

test('ColDefinition.wrap returns a Collection when given service and name', (t) => {
  const def = colDef<{ id: string }>()
  const mockService = {
    nativeCollection: async () => ({} as any),
    nextCounterValue: async () => 0,
    withTransaction: async (fn: () => Promise<any>) => fn(),
  } as any
  const col = def.wrap(mockService, 'test_col', [])
  t.truthy(col)
  t.is(col.name, 'test_col')
  t.truthy(typeof col.findById === 'function')
  t.truthy(typeof col.insert === 'function')
})
