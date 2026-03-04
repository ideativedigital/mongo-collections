
import { CreateIndexesOptions, Document, IndexSpecification } from 'mongodb';

import { Collection, Substituers, wrapMongoCollection } from './mongo-collection';
import { MongoService } from './mongo-service';

export type Indexes = { spec: IndexSpecification; options?: CreateIndexesOptions }[]

export class TypeHolder<T> {
  readonly Type!: T
}

export type colType<CD extends ColDefinition<any>> = CD['Type']
/**
 * Collection definition to embed into providers
 */
export class ColDefinition<T extends Document = any> extends TypeHolder<T> {
  readonly indexes: Indexes
  readonly substituers?: Substituers<T, T>
  constructor({
    indexes,
    substituers
  }: {

    indexes: Indexes
    substituers: Substituers<T, T>
  }) {
    super()

    this.indexes = indexes
    this.substituers = substituers
  }

  wrap(service: MongoService, collection: string, indexes: Indexes) {
    return wrapMongoCollection(service, collection, indexes, this.substituers ?? {})
  }
}
export type mongoCollection<C extends ColDefinition<any>> = C extends ColDefinition<infer T>
  ? Collection<T>
  : never

export function colDef<T extends Document>(
  {
    indexes,
    substituers
  }: {

    indexes?: Indexes
    substituers?: Substituers<T, T>
  } = { indexes: [], substituers: {} }
) {
  return new ColDefinition<T>({ indexes: indexes ?? [], substituers: substituers ?? {} })
}

export function defineColDef({ substituers }: { substituers: Substituers }) {
  return <T extends Document>(indexes: Indexes) => new ColDefinition<T>({ indexes, substituers })
}
