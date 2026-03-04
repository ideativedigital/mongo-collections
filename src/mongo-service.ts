
import {
    Db,
    Document,
    GridFSBucket,
    Collection as MCollection,
    MongoClient,
    MongoClientEvents,
    MongoClientOptions,
    ObjectId
} from 'mongodb'

import { ColDefinition, mongoCollection } from './col-definition'
import { GridFSBucketProxy } from './gridfs-bucket-proxy'
import { Collection } from './mongo-collection'


const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const logger = console

let _clientPromise: Promise<MongoClient>

export type MongoOptions = MongoClientOptions & {
    userAuditionProvider?: () => string
}
export const DefaultMongoClientOptions: MongoClientOptions = {}

const getClientPromise = async (client: MongoClient, forceReconnect: boolean = false) => {
    return new Promise<MongoClient>(async (res, rej) => {
        try {
            if (!_clientPromise || forceReconnect) {
                if (process.env.NODE_ENV === 'development') {
                    // In development mode, use a global variable so that the value
                    // is preserved across module reloads caused by HMR (Hot Module Replacement).
                    if (!(global as any)._mongoClientPromise) {
                        logger.debug('Connecting Mongo in development using global')
                        _clientPromise = Promise.resolve(await client.connect())
                            ; (global as any)._mongoClientPromise = _clientPromise
                        res(await _clientPromise)
                    } else {
                        _clientPromise = (global as any)._mongoClientPromise
                        res(await _clientPromise)
                    }
                } else {
                    logger.info('Connecting Mongo')
                    // In production mode, it's best to not use a global variable.
                    _clientPromise = Promise.resolve(await client.connect())
                    res(await _clientPromise)
                }
            } else {
                res(await _clientPromise)
            }
        } catch (e) {
            logger.error('An error happened while connecting mongo ', e)
            rej(e)
        }
    })
}

const resetEvents: (keyof MongoClientEvents)[] = ['close', 'topologyClosed', 'timeout']
/**
 * Mongo Service to stronly type and provide everything you need to use Mongo
 */
export class MongoService {
    private client: MongoClient
    private isDisconnected = false
    private isClosed = false

    private constructor(
        connectionString: string,
        private options: MongoOptions = DefaultMongoClientOptions
    ) {
        this.client = new MongoClient(connectionString, options)
        resetEvents.forEach(k => {
            this.client.addListener(k, async () => {
                if (this.isClosed) return
                logger.warn('A %s event happened on Mongo, reconnecting...', k)
                const client = await getClientPromise(this.client, true)
                await client.close()
                this.isDisconnected = true
            })
        })
    }

    private async withDb<T>(fn: (db: Db) => Promise<T> | T, retries: number = 2): Promise<T> {
        try {
            if (!_clientPromise || !this.isDisconnected) {
                this.client = await getClientPromise(this.client)
            }
        } catch (e) {
            if (retries > 0) {
                // needs to be more granular maybe ?
                logger.warn('An error happened with acquiring a mongo connection, retrying')
                await delay(100)
                return this.withDb(fn, retries - 1)
            } else {
                logger.error("Couldn't get a mongo connection ", e)
                throw e
            }
        }
        return fn(this.client.db())
    }

    async getDB(retries: number = 2): Promise<Db> {
        try {
            if (!_clientPromise || !this.isDisconnected) {
                this.client = await getClientPromise(this.client)
            }
        } catch (e) {
            if (retries > 0) {
                // needs to be more granular maybe ?
                logger.warn('An error happened with acquiring a mongo connection, retrying')
                await delay(100)
                return this.getDB(retries - 1)
            } else {
                logger.error("Couldn't get a mongo connection ", e)
                throw e
            }
        }
        return this.client.db()
    }

    private withAsyncDb<T>(fn: (db: Promise<Db>) => T): T {
        return fn(this.getDB())
    }

    withTransaction<T = void>(fn: () => Promise<T>): Promise<T> {
        return this.withDb<T>(async () => {
            const session = this.client.startSession()
            try {
                session.startTransaction()
                const result = await fn()
                session.commitTransaction()
                return result
            } catch (e) {
                logger.error('transaction error: ', e)
                session.abortTransaction()
                throw e
            } finally {
                session.endSession()
            }
        })
    }

    /**
     * native collection
     * @param name collection name
     * @returns the collection
     */
    async nativeCollection<T extends Document>(
        name: string
    ): Promise<MCollection<T>> {
        return this.withDb(db => {
            return db.collection<T>(name)
        })
    }



    public getCollection<ColName extends string, C extends ColDefinition<any>>(name: ColName, t: C) {
        return t.wrap(this, name, t.indexes) as mongoCollection<C>
    }

    public async gridfs(): Promise<GridFSBucket> {
        return this.withDb(db => new GridFSBucket(db))
    }

    public static create(conString: string) {
        return new MongoService(conString)
    }

    /** Close the underlying MongoClient. Use for cleanup in tests. */
    public async close(): Promise<void> {
        this.isClosed = true
        await this.client.close()
    }

    public getUserForAudit() {
        return this.options.userAuditionProvider?.()
    }

    public async nextCounterValue(counter: string): Promise<number> {
        const res = await this.withDb(db => db.collection<{ id: string; counter: number }>('__counters').findOneAndUpdate({ id: counter }, { $inc: { counter: 1 } }, { returnDocument: 'after', upsert: true }))
        return res!.counter
    }


}

export const newId = (): string => new ObjectId().toHexString()

export type { GridFSBucket }

export { ObjectId }

export type MongoDatabase<C extends Record<string, ColDefinition>> = {
    [k in keyof C]: mongoCollection<C[k]>
}
export type MongoResult<C extends Record<string, ColDefinition>> = MongoDatabase<C> & {
    ensureIndexes: () => Promise<void>
    gridfs: GridFSBucketProxy
    withTransaction: <T = void>(fn: () => Promise<T>) => Promise<T>
}

export function mongoDatabase<C extends Record<string, ColDefinition>>(
    service: MongoService | string,
    collections: C
): MongoResult<C> {
    const mongoService = typeof service === 'string' ? MongoService.create(service) : service
    const result = Object.entries(collections).reduce((acc, [name, typ]) => {
        return {
            ...acc,
            [name as keyof C]: mongoService.getCollection(name, typ)
        }
    }, {} as MongoDatabase<C>)

    return {
        ...result,
        ensureIndexes: async () => {
            await Promise.all((Object.values(result) as Collection<any>[]).map(c => c.ensureIndexes()))
        },
        gridfs: new GridFSBucketProxy(mongoService.getDB()),
        withTransaction: <T = void>(fn: () => Promise<T>) => mongoService.withTransaction(fn)
    } as MongoResult<C>
}
