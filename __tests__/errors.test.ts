import test from 'ava'
import {
  BadParametersError,
  DuplicateError,
  MongoErrors,
  NotFoundError,
} from '../src/errors/mongo-errors'

test('MongoErrors constants', (t) => {
  t.is(MongoErrors.DUPLICATE_KEY, 11000)
  t.is(MongoErrors.WRITE_CONFLICT, 112)
})

test('NotFoundError: message and properties', (t) => {
  const err = new NotFoundError('user-123', 'users')
  t.true(err instanceof Error)
  t.true(err instanceof NotFoundError)
  t.is(err.message, 'user-123 not found in users')
  t.is(err.element, 'user-123')
  t.is(err.collectionName, 'users')
})

test('DuplicateError: message and properties', (t) => {
  const err = new DuplicateError('user-123', 'users')
  t.true(err instanceof Error)
  t.true(err instanceof DuplicateError)
  t.is(err.message, 'user-123 already exists in users')
  t.is(err.element, 'user-123')
  t.is(err.collectionName, 'users')
})

test('BadParametersError: message and properties', (t) => {
  const err = new BadParametersError('Invalid filter', 'users')
  t.true(err instanceof Error)
  t.true(err instanceof BadParametersError)
  t.is(err.message, 'Invalid filter in users')
  t.is(err.reason, 'Invalid filter')
  t.is(err.collectionName, 'users')
})
