

import {
  CountDocumentsOptions,
  DeleteOptions,
  DeleteResult,
  Document,
  Filter,
  FindCursor,
  FindOneAndDeleteOptions,
  FindOneAndReplaceOptions,
  FindOneAndUpdateOptions,
  FindOptions,
  Collection as MCollection,
  ObjectId,
  OptionalUnlessRequiredId,
  UpdateFilter,
  UpdateOptions,
  UpdateResult,
  WithoutId,
  WriteError
} from 'mongodb'
import { Indexes } from './col-definition'

import { BadParametersError, DuplicateError, MongoErrors, NotFoundError } from './errors'
import { type MongoService } from './mongo-service'
import { Substituer } from './utils/substitute'

/**
 * Maps values between API and database representations.
 * Keep this simple: implement `toDb` and `toApi` for document-level conversion,
 * then optionally specialize filters and updates.
 */
export type ModelMapper<ApiModel extends Document = Document, DbModel extends Document = ApiModel> = {
  toDb: (apiModel: ApiModel) => DbModel
  toApi: (dbModel: DbModel) => ApiModel
  filterToDb?: (filter: Filter<ApiModel>) => Filter<DbModel>
  updateToDb?: (update: UpdateFilter<ApiModel>) => UpdateFilter<DbModel>
}

export type ChainableModelMapper<
  ApiModel extends Document = Document,
  DbModel extends Document = ApiModel
> = ModelMapper<ApiModel, DbModel> & {
  and: <NextDbModel extends Document>(
    next: ModelMapper<DbModel, NextDbModel>
  ) => ChainableModelMapper<ApiModel, NextDbModel>
}

/**
 * Optional transformers applied when reading/writing documents.
 * - `in`: applied to filters and updates before sending to MongoDB
 * - `out`: applied to documents when reading from MongoDB (and as legacy pre-write transformer)
 * - `mapper`: explicit API <-> DB mapping; preferred when API and DB models differ
 */
export type Substituers<ApiModel extends Document = Document, DbModel extends Document = ApiModel> = {
  in?: Substituer
  out?: Substituer
  mapper?: Partial<ModelMapper<ApiModel, DbModel>>
}

/**
 * Wrapper around a Mongo Collection. Applies optional substituers for id/field translation,
 * and throws domain errors (e.g. NotFoundError, DuplicateError) instead of returning raw results.
 *
 * @typeParam T - Document type; must extend Document (e.g. have an `id` field).
 */
export class Collection<T extends Document, DbModel extends Document = T> {
  readonly Type!: T
  protected readonly mapper: ModelMapper<T, DbModel>

  /**
   * @param service - Mongo service used to obtain the native collection
   * @param name - Collection name
   * @param indexes - Index definitions to create via {@link ensureIndexes}
   * @param substituers - Optional in/out transformers for filters and documents
   */
  constructor(
    protected service: MongoService,
    readonly name: string,
    protected readonly indexes: Indexes,
    protected readonly substituers: Substituers<T, DbModel> = {}
  ) {
    this.mapper = {
      toDb: (doc: T) => (this.substituers.mapper?.toDb
        ? this.substituers.mapper.toDb(doc)
        : this.substituers.out
          ? this.substituers.out(doc)
          : doc) as DbModel,
      toApi: (doc: DbModel) => (this.substituers.mapper?.toApi
        ? this.substituers.mapper.toApi(doc)
        : this.substituers.out
          ? this.substituers.out(doc)
          : doc) as T,
      filterToDb: (filter: Filter<T>) => (this.substituers.mapper?.filterToDb
        ? this.substituers.mapper.filterToDb(filter)
        : this.substituers.in
          ? this.substituers.in(filter)
          : filter) as Filter<DbModel>,
      updateToDb: (update: UpdateFilter<T>) => (this.substituers.mapper?.updateToDb
        ? this.substituers.mapper.updateToDb(update)
        : this.substituers.in
          ? this.substituers.in(update)
          : update) as UpdateFilter<DbModel>,
    }
  }

  /** Creates indexes defined in the collection config. No-op if indexes array is empty. */
  public async ensureIndexes() {
    if (this.indexes.length > 0) {
      const col = await this.service.nativeCollection<DbModel>(this.name)
      await Promise.all(
        this.indexes.map(({ spec, options }) => col.createIndex(spec, options))
      )
    }
  }

  /** Returns the next counter value for the collection. */
  public nextCounterValue(): Promise<number> {
    return this.service.nextCounterValue(`${this.name}_counter_`)
  }

  /**
   * Awaits the promise and throws NotFoundError or BadParametersError if the result is null.
   * @param p - Promise resolving to a document or null
   * @param elementIfNotFound - Identifier for the error message (e.g. id string or filter)
   */
  protected async getOrThrow<R extends Document>(
    p: Promise<R | null>,
    elementIfNotFound: string | Filter<T>
  ) {
    const result = await p
    if (!result)
      if (typeof elementIfNotFound === 'string')
        throw new NotFoundError(elementIfNotFound, this.name)
      else {
        throw new BadParametersError(JSON.stringify(elementIfNotFound), this.name)
      }
    return result
  }


  /** Runs the given function with the native MongoDB collection for this collection name. */
  protected async withCollection<R>(fn: (col: MCollection<DbModel>) => Promise<R>) {
    const col = await this.service.nativeCollection<DbModel>(this.name)
    return fn(col)
  }

  /** Native MongoDB collection for this collection name. */
  get underlying(): Promise<MCollection<DbModel>> {
    return this.service.nativeCollection<DbModel>(this.name)
  }

  /** Applies the `in` substituer to a filter before sending to MongoDB. */
  protected filterToMongoFilter(f: Filter<T>): Filter<DbModel> {
    return this.mapper.filterToDb ? this.mapper.filterToDb(f) : f as unknown as Filter<DbModel>
  }

  /** Applies the `in` substituer to an update before sending to MongoDB. */
  protected updateToMongoUpdate(f: UpdateFilter<T>): UpdateFilter<DbModel> {
    return this.mapper.updateToDb ? this.mapper.updateToDb(f) : f as unknown as UpdateFilter<DbModel>
  }

  /** Transforms a document from API shape to DB shape via mapper (or legacy substituers). */
  public fromApi(doc: T): DbModel {
    return this.mapper.toDb(doc)
  }

  /** Transforms a document from DB shape to API shape via mapper (or legacy substituers). */
  public toApi<R extends Document = T>(doc: DbModel): R {
    return this.mapper.toApi(doc) as unknown as R
  }

  /** Alias for explicit API -> DB conversion when API/DB models differ. */
  public toDbModel(doc: T): DbModel {
    return this.fromApi(doc)
  }

  /** Alias for explicit DB -> API conversion when API/DB models differ. */
  public toApiModel(doc: DbModel): T {
    return this.toApi(doc)
  }

  /**
   * Finds a single document by `id`. Returns null if not found.
   * @param id - Document id
   * @param options - Find options; use `ignoreCase: true` for case-insensitive id match
   */
  public async findById<R extends Document = T>(
    id: T['id'],
    options?: FindOptions & { ignoreCase?: boolean }
  ): Promise<R | null> {
    return this.findOne<R>(
      { id: options?.ignoreCase ? new RegExp(`^${id}$`, 'i') : id },
      options
    )
  }

  /**
   * Gets a single document by `id`. Throws {@link NotFoundError} if not found.
   * @param id - Document id
   * @param options - Find options; use `ignoreCase: true` for case-insensitive id match
   */
  public async getById<R extends Document = T>(
    id: T['id'],
    options?: FindOptions & { ignoreCase?: boolean }
  ): Promise<R> {
    return this.getOrThrow(this.findById<R>(id, options), id)
  }

  /**
   * Finds a single document matching the filter. Returns null if not found.
   * Result is transformed with {@link toApi}.
   */
  public async findOne<R extends Document = T>(
    filter: Filter<T>,
    options?: FindOptions
  ): Promise<R | null> {
    const result = await this.withCollection(col =>
      col.findOne<DbModel>(this.filterToMongoFilter(filter), options)
    )
    return result && this.toApi<R>(result)
  }

  /**
   * Gets a single document matching the filter. Throws {@link BadParametersError} if not found.
   */
  public async getOne<R extends Document = T>(
    filter: Filter<T>,
    options?: FindOptions
  ): Promise<R> {
    return this.getOrThrow(this.findOne(filter, options), filter)
  }

  /**
   * Returns a find cursor over documents matching the filter.
   * Each document is transformed with {@link toApi}.
   */
  public async cursor<R extends Document = T>(
    filter: Filter<T>,
    options?: FindOptions
  ): Promise<FindCursor<R>> {
    const col = await this.service.nativeCollection<DbModel>(this.name)

    const result = col.find<DbModel>(this.filterToMongoFilter(filter), options)

    return result.map((doc) => this.toApi<R>(doc))
  }

  /**
   * Finds all documents matching the filter and returns them as an array.
   * Results are transformed with {@link toApi}.
   */
  public async find<R extends Document = T>(
    filter: Filter<T> = {},
    options?: FindOptions
  ): Promise<R[]> {
    return (await this.cursor<R>(filter, options)).toArray()
  }

  /**
   * Inserts a single document. Throws {@link DuplicateError} on duplicate key.
   * @returns The document with `id` set (from argument or insertedId)
   */
  public async insert(element: T): Promise<T> {
    try {
      const res = await this.withCollection(col =>
        col.insertOne(this.fromApi(element) as OptionalUnlessRequiredId<DbModel>)
      )
      return { ...element, id: element.id ?? res.insertedId }
    } catch (e) {
      if ((e as WriteError).code === MongoErrors.DUPLICATE_KEY) {
        throw new DuplicateError(element.id + '', this.name)
      } else {
        throw e
      }
    }
  }

  /**
   * Inserts multiple documents. Throws {@link DuplicateError} on duplicate key.
   */
  public async insertMany(element: T[]): Promise<void> {
    const documents = element.map((doc) => this.fromApi(doc)) as OptionalUnlessRequiredId<DbModel>[]
    try {
      await this.withCollection(col =>
        col.insertMany(documents)
      )
    } catch (e) {
      if ((e as WriteError).code === MongoErrors.DUPLICATE_KEY) {
        throw new DuplicateError(documents.map(d => d.id).join(','), this.name)
      } else {
        throw e
      }
    }
  }

  /** Updates at most one document matching the filter. */
  public async updateOne(
    filter: Filter<T>,
    update: UpdateFilter<T>,
    options?: UpdateOptions
  ): Promise<UpdateResult> {
    return this.withCollection(col =>
      col.updateOne(this.filterToMongoFilter(filter), this.updateToMongoUpdate(update), options)
    )
  }

  /** Updates all documents matching the filter. */
  public async updateMany(
    filter: Filter<T>,
    update: UpdateFilter<T>,
    options?: UpdateOptions
  ): Promise<UpdateResult> {
    return this.withCollection(col =>
      col.updateMany(this.filterToMongoFilter(filter), this.updateToMongoUpdate(update), options)
    )
  }

  /** Updates at most one document with the given `id`. */
  public async updatebyId(
    id: T['id'],
    update: UpdateFilter<T>,
    options?: UpdateOptions
  ): Promise<UpdateResult> {
    return this.updateOne({ id }, update, options)
  }

  /** Replaces at most one document matching the filter with the given document (without id). */
  public async replaceOne(
    filter: Filter<T>,
    update: WithoutId<T>,
    options?: UpdateOptions
  ): Promise<UpdateResult | Document> {
    return this.withCollection(col =>
      col.replaceOne(
        this.filterToMongoFilter(filter),
        update as unknown as WithoutId<DbModel>,
        options
      )
    )
  }

  /**
   * Finds one document matching the filter and applies the update. Returns null if not found.
   * Result is transformed with {@link toApi}.
   */
  public async findOneAndUpdate(
    filter: Filter<T>,
    update: UpdateFilter<T>,
    options?: Omit<FindOneAndUpdateOptions, 'projection'>
  ): Promise<T | null> {
    const result = await this.withCollection(col =>
      col.findOneAndUpdate(
        this.filterToMongoFilter(filter),
        this.updateToMongoUpdate(update),
        options ?? {}
      )
    )
    return result && result && this.toApi<T>(result as DbModel)
  }

  /**
   * Gets one document matching the filter and applies the update. Throws if not found.
   */
  public async getOneAndUpdate(
    filter: Filter<T>,
    update: UpdateFilter<T>,
    options?: Omit<FindOneAndUpdateOptions, 'projection'>
  ): Promise<T> {
    return this.getOrThrow(this.findOneAndUpdate(filter, update, options), filter)
  }

  /** Finds one document by `id` and applies the update. Returns null if not found. */
  public async findAndUpdateById(
    id: T['id'],
    update: UpdateFilter<T>,
    options?: Omit<FindOneAndUpdateOptions, 'projection'>
  ): Promise<T | null> {
    return this.findOneAndUpdate({ id }, update, options)
  }

  /** Gets one document by `id` and applies the update. Throws if not found. */
  public async getAndUpdateById(
    id: T['id'],
    update: UpdateFilter<T>,
    options?: Omit<FindOneAndUpdateOptions, 'projection'>
  ): Promise<T> {
    return this.getOrThrow(this.findAndUpdateById(id, update, options), id)
  }

  /**
   * Finds one document matching the filter and replaces it with the given document (without id).
   * Returns null if not found. Result is transformed with {@link toApi}.
   */
  public async findOneAndReplace(
    filter: Filter<T>,
    update: Omit<T, 'id'>,
    options?: Omit<FindOneAndReplaceOptions, 'projection'>
  ): Promise<T | null> {
    const result = await this.withCollection(col =>
      col.findOneAndReplace(
        this.filterToMongoFilter(filter),
        update as unknown as WithoutId<DbModel>,
        options ?? {}
      )
    )
    return result && result && this.toApi<T>(result as DbModel)
  }

  /** Gets one document matching the filter and replaces it. Throws if not found. */
  public async getOneAndReplace(
    filter: Filter<T>,
    update: Omit<T, 'id'>,
    options?: Omit<FindOneAndReplaceOptions, 'projection'>
  ): Promise<T> {
    return this.getOrThrow(this.findOneAndReplace(filter, update, options), filter)
  }

  /**
   * Finds one document matching the filter and deletes it. Returns null if not found.
   * Deleted document is transformed with {@link toApi}.
   */
  public async findOneAndDelete(
    filter: Filter<T>,
    options?: Omit<FindOneAndDeleteOptions, 'projection'>
  ): Promise<T | null> {
    const result = await this.withCollection(col =>
      col.findOneAndDelete(this.filterToMongoFilter(filter), options ?? {})
    )
    return result && result && this.toApi<T>(result as DbModel)
  }

  /** Gets one document matching the filter and deletes it. Throws if not found. */
  public async getOneAndDelete(filter: Filter<T>, options?: FindOneAndDeleteOptions): Promise<T> {
    return this.getOrThrow(this.findOneAndDelete(filter, options), filter)
  }

  /** Finds one document by `id` and deletes it. Returns null if not found. */
  public async findAndDeleteById(
    id: T['id'],
    options?: Omit<FindOneAndDeleteOptions, 'projection'>
  ): Promise<T | null> {
    return this.findOneAndDelete({ id }, options)
  }

  /** Gets one document by `id` and deletes it. Throws if not found. */
  public async getAndDeleteById(
    id: T['id'],
    options?: Omit<FindOneAndDeleteOptions, 'projection'>
  ): Promise<T> {
    return this.getOrThrow(this.findAndDeleteById(id, options), id)
  }

  /** Deletes at most one document matching the filter. */
  public async deleteOne(filter: Filter<T>, options?: DeleteOptions): Promise<DeleteResult> {
    return this.withCollection(col => col.deleteOne(this.filterToMongoFilter(filter), options))
  }

  /** Deletes at most one document with the given `id`. */
  public async deleteById(id: T['id'], options?: DeleteOptions): Promise<DeleteResult> {
    return this.deleteOne({ id }, options)
  }

  /** Deletes all documents matching the filter. */
  public async deleteMany(filter: Filter<T>, options?: DeleteOptions): Promise<DeleteResult> {
    return this.withCollection(col => col.deleteMany(this.filterToMongoFilter(filter), options))
  }

  /** Returns the number of documents matching the filter. */
  public async count(filter: Filter<T>, options?: CountDocumentsOptions): Promise<number> {
    return this.withCollection(col => col.countDocuments(this.filterToMongoFilter(filter), options))
  }

  /** Returns true if at least one document matches the filter. */
  public async exists(filter: Filter<T>): Promise<boolean> {
    const count = await this.count(filter)
    return count > 0
  }

  /**
   * Finds one document matching the filter, runs the updater, then updates with the result.
   * Runs inside a transaction. Returns null if no document matches.
   * @param filter - Filter to find the document
   * @param fn - Async function that receives the current document and returns the updated document
   */
  public async findThenUpdateOne(
    filter: Filter<T>,
    fn: (before: T) => Promise<T>
  ): Promise<T | null> {
    return this.service.withTransaction(async () => {
      const before = await this.findOne(filter)
      if (!before) return null
      else {
        const after = await fn(before)
        return this.findOneAndUpdate(filter, after, { returnDocument: 'after' })
      }
    })
  }

  /**
   * Gets one document matching the filter, runs the updater, then updates with the result.
   * Runs inside a transaction. Throws if no document matches.
   * @param filter - Filter to find the document
   * @param fn - Async function that receives the current document and returns the updated document
   */
  public async getThenUpdateOne(
    filter: Filter<T>,
    fn: (before: T) => Promise<T>
  ): Promise<T> {
    return this.service.withTransaction(async () => {
      const before = await this.getOne(filter)
      const after = await fn(before)
      return this.getOneAndUpdate(filter, after, { returnDocument: 'after' })
    })
  }
}

/**
 * Helper for authoring typed API <-> DB mappers without extra ceremony.
 */
export const modelMapper = <ApiModel extends Document, DbModel extends Document = ApiModel>(
  mapper: ModelMapper<ApiModel, DbModel>
): ChainableModelMapper<ApiModel, DbModel> =>
  Object.assign(mapper, {
    and: <NextDbModel extends Document>(next: ModelMapper<DbModel, NextDbModel>) =>
      chainModelMappers(mapper, next),
  })

/**
 * Compose two model mappers into one.
 * Useful when you want layered transformations (e.g. API -> domain -> DB).
 *
 * Composition order is left-to-right for `toDb`:
 * `toDb = second.toDb(first.toDb(api))`
 *
 * and reversed for `toApi`:
 * `toApi = first.toApi(second.toApi(db))`
 */
export const chainModelMappers = <
  ApiModel extends Document,
  IntermediateModel extends Document,
  DbModel extends Document
>(
  first: ModelMapper<ApiModel, IntermediateModel>,
  second: ModelMapper<IntermediateModel, DbModel>
): ChainableModelMapper<ApiModel, DbModel> =>
  modelMapper<ApiModel, DbModel>({
    toDb: (apiModel) => second.toDb(first.toDb(apiModel)),
    toApi: (dbModel) => first.toApi(second.toApi(dbModel)),
    filterToDb: (filter) => {
      const intermediate = first.filterToDb
        ? first.filterToDb(filter)
        : (filter as unknown as Filter<IntermediateModel>)
      return second.filterToDb
        ? second.filterToDb(intermediate)
        : (intermediate as unknown as Filter<DbModel>)
    },
    updateToDb: (update) => {
      const intermediate = first.updateToDb
        ? first.updateToDb(update)
        : (update as unknown as UpdateFilter<IntermediateModel>)
      return second.updateToDb
        ? second.updateToDb(intermediate)
        : (intermediate as unknown as UpdateFilter<DbModel>)
    },
  })

type MongoIdMapperOptions = {
  /**
   * Parse 24-hex string ids to ObjectId for Mongo queries/writes.
   * @default true
   */
  parseObjectId?: boolean
  /**
   * Convert ObjectId values to string when exposing `id`.
   * @default true
   */
  stringifyObjectId?: boolean
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype

const toMongoIdValue = (value: unknown, parseObjectId: boolean): unknown => {
  if (!parseObjectId) return value
  if (typeof value === 'string' && ObjectId.isValid(value) && value.length === 24) {
    return new ObjectId(value)
  }
  return value
}

const toApiIdValue = (value: unknown, stringifyObjectId: boolean): unknown => {
  if (stringifyObjectId && value instanceof ObjectId) {
    return value.toHexString()
  }
  return value
}

const replaceKeyDeep = (
  value: unknown,
  fromKey: string,
  toKey: string,
  transformValue?: (v: unknown) => unknown
): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => replaceKeyDeep(item, fromKey, toKey, transformValue))
  }
  if (!isPlainObject(value)) return value

  return Object.fromEntries(
    Object.entries(value).map(([key, val]) => {
      const mappedKey =
        key === fromKey
          ? toKey
          : key.endsWith(`.${fromKey}`)
            ? `${key.slice(0, -fromKey.length)}${toKey}`
            : key
      const nextValue = transformValue && mappedKey === toKey ? transformValue(val) : val
      return [mappedKey, replaceKeyDeep(nextValue, fromKey, toKey, transformValue)]
    })
  )
}

/**
 * Built-in mapper to transparently bridge API `id` and Mongo `_id`.
 *
 * Useful when your API model uses `id` while Mongo collections use `_id`.
 */
export const mongoIdMapper = <
  ApiModel extends Document & { id?: unknown },
  DbModel extends Document & { _id?: unknown } = Document & { _id?: unknown }
>(
  options: MongoIdMapperOptions = {}
): ModelMapper<ApiModel, DbModel> => {
  const parseObjectId = options.parseObjectId ?? true
  const stringifyObjectId = options.stringifyObjectId ?? true

  return modelMapper<ApiModel, DbModel>({
    toDb: (apiModel) =>
      replaceKeyDeep(apiModel, 'id', '_id', (v) => toMongoIdValue(v, parseObjectId)) as DbModel,
    toApi: (dbModel) =>
      replaceKeyDeep(dbModel, '_id', 'id', (v) => toApiIdValue(v, stringifyObjectId)) as ApiModel,
    filterToDb: (filter) =>
      replaceKeyDeep(filter, 'id', '_id', (v) => toMongoIdValue(v, parseObjectId)) as Filter<DbModel>,
    updateToDb: (update) =>
      replaceKeyDeep(update, 'id', '_id', (v) => toMongoIdValue(v, parseObjectId)) as UpdateFilter<DbModel>,
  })
}

/**
 * Creates a {@link Collection} wrapper for a MongoDB collection.
 *
 * @param service - Mongo service used to obtain the native collection
 * @param name - Collection name
 * @param indexes - Index definitions (default: empty array)
 * @returns Wrapped collection instance
 */
export const wrapMongoCollection = <T extends Document, DbModel extends Document = T>(
  service: MongoService,
  name: string,
  indexes: Indexes = [],
  substituers: Substituers<T, DbModel> = {}
) => {
  return new Collection<T, DbModel>(service, name, indexes, substituers)
}

export type {
  CountDocumentsOptions,
  CreateIndexesOptions,
  DeleteOptions,
  DeleteResult,
  Document, Filter, FindCursor,
  FindOneAndDeleteOptions,
  FindOneAndReplaceOptions,
  FindOneAndUpdateOptions,
  FindOptions,
  IndexSpecification,
  OptionalUnlessRequiredId, UpdateFilter,
  UpdateOptions,
  UpdateResult,
  WithoutId,
  WriteError
} from 'mongodb'

