import test from 'ava'
import { substitute, substituteBuilder } from '../src/utils/substitute'

test('substitute: replaces matching values in deep structures', (t) => {
  const dateToIso = substitute(
    (x): x is Date => x instanceof Date,
    (d) => d.toISOString()
  )
  const input = {
    a: 1,
    b: new Date('2024-01-15T12:00:00.000Z'),
    c: { nested: new Date('2024-02-01T00:00:00.000Z') },
    d: [new Date('2024-03-01T00:00:00.000Z'), 2],
  }
  const out = dateToIso(input)
  t.is(out.a, 1)
  t.is(out.b, '2024-01-15T12:00:00.000Z')
  t.is(out.c.nested, '2024-02-01T00:00:00.000Z')
  t.deepEqual(out.d, ['2024-03-01T00:00:00.000Z', 2])
})

test('substitute: leaves non-matching values and primitives unchanged', (t) => {
  const onlyDates = substitute(
    (x): x is Date => x instanceof Date,
    (d) => d.toISOString()
  )
  t.is(onlyDates(42), 42)
  t.is(onlyDates('hello'), 'hello')
  t.is(onlyDates(null), null)
  t.deepEqual(onlyDates({ x: 1, y: 'a' }), { x: 1, y: 'a' })
})

test('substitute: does not recurse into class instances when not matched', (t) => {
  class MyClass { }
  const dateToIso = substitute(
    (x): x is Date => x instanceof Date,
    (d) => d.toISOString()
  )
  const instance = new MyClass()
  const input = { r: instance }
  const out = dateToIso(input)
  t.is(out.r, instance)
  t.true(out.r instanceof MyClass)
})

test('substitute: .and composes in correct order (b(a(x)))', (t) => {
  const a = substitute(
    (x): x is number => typeof x === 'number',
    (n) => n * 2
  )
  const b = substitute(
    (x): x is number => typeof x === 'number',
    (n) => n + 1
  )
  const composed = a.and(b)
  // (2 * 2) + 1 = 5
  t.is(composed({ value: 2 }).value, 5)
})

test('substitute: two substituers in sequence both applied', (t) => {
  const dateToIso = substitute(
    (x): x is Date => x instanceof Date,
    (d) => d.toISOString()
  )
  const wrapInObj = substitute(
    (x): x is string => typeof x === 'string' && x.startsWith('2024'),
    (s) => ({ iso: s })
  )
  const composed = dateToIso.and(wrapInObj)
  const input = { t: new Date('2024-01-01T00:00:00.000Z') }
  const out = composed(input)
  t.deepEqual(out.t, { iso: '2024-01-01T00:00:00.000Z' })
})

test('substituteBuilder: .when adds rules, first match wins', (t) => {
  const s = substituteBuilder()
    .when((x): x is number => typeof x === 'number', (n) => n + 1)
    .when((x): x is string => typeof x === 'string', (str) => str.toUpperCase())
    .build()
  t.is(s(5), 6)
  t.is(s('hi'), 'HI')
  t.is(s(true), true)
})

test('substituteBuilder: multiple .when, order matters', (t) => {
  const s = substituteBuilder()
    .when((x): x is number => typeof x === 'number', () => 'first')
    .when((x): x is number => typeof x === 'number', () => 'second')
    .build()
  t.is(s(42), 'first')
})

test('substituteBuilder: .then composes result = substituer(built(obj))', (t) => {
  const double = substitute(
    (x): x is number => typeof x === 'number',
    (n) => n * 2
  )
  const s = substituteBuilder()
    .when((x): x is number => typeof x === 'number', (n) => n + 1)
    .then(double)
    .build()
  // (3+1)*2 = 8
  t.is(s(3), 8)
})

test('substituteBuilder: .build() returns Substituer with working .and()', (t) => {
  const s = substituteBuilder()
    .when((x): x is number => typeof x === 'number', (n) => n * 2)
    .build()
  const extra = substitute(
    (x): x is number => typeof x === 'number',
    (n) => n + 10
  )
  const chained = s.and(extra)
  t.is(chained(5), 20) // 5*2+10
})

test('substituteBuilder: empty builder behaves as identity', (t) => {
  const s = substituteBuilder().build()
  const input = { a: 1, b: [2, 3], c: { d: 4 } }
  t.deepEqual(s(input), input)
})
