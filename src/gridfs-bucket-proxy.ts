import {
  Db,
  EventsDescription,
  Filter,
  FindOptions,
  GridFSBucket,
  GridFSBucketOptions,
  GridFSBucketReadStreamOptions,
  GridFSBucketReadStreamOptionsWithRevision,
  GridFSBucketWriteStreamOptions,
  GridFSFile,
  ObjectId
} from 'mongodb'

// Helper to get all method names (excluding constructor) from a class prototype
function getAllMethodNames(obj: any): string[] {
  const methods = new Set<string>()
  let proto = obj
  while (proto && proto !== Object.prototype) {
    Object.getOwnPropertyNames(proto)
      .filter(
        name => typeof proto[name] === 'function' && name !== 'constructor' && !name.startsWith('_')
      )
      .forEach(name => methods.add(name))
    proto = Object.getPrototypeOf(proto)
  }
  return Array.from(methods)
}

export class GridFSBucketProxy {
  private dbPromise: Promise<Db>
  private options?: GridFSBucketOptions
  private bucketPromise?: Promise<GridFSBucket>

  constructor(dbPromise: Promise<Db>, options?: GridFSBucketOptions) {
    this.dbPromise = dbPromise
    this.options = options
  }

  private async getBucket(): Promise<GridFSBucket> {
    if (!this.bucketPromise) {
      this.bucketPromise = this.dbPromise.then(db => new GridFSBucket(db, this.options))
    }
    return this.bucketPromise
  }

  // Proxy all known methods as async
  async openUploadStream(filename: string, options?: GridFSBucketWriteStreamOptions) {
    const bucket = await this.getBucket()
    return bucket.openUploadStream(filename, options)
  }

  async openUploadStreamWithId(
    id: ObjectId,
    filename: string,
    options?: GridFSBucketWriteStreamOptions
  ) {
    const bucket = await this.getBucket()
    return bucket.openUploadStreamWithId(id, filename, options)
  }

  async openDownloadStream(id: ObjectId, options?: GridFSBucketReadStreamOptions) {
    const bucket = await this.getBucket()
    return bucket.openDownloadStream(id, options)
  }

  async openDownloadStreamByName(
    filename: string,
    options?: GridFSBucketReadStreamOptionsWithRevision
  ) {
    const bucket = await this.getBucket()
    return bucket.openDownloadStreamByName(filename, options)
  }

  async find(filter?: Filter<GridFSFile>, options?: FindOptions) {
    const bucket = await this.getBucket()
    return bucket.find(filter, options)
  }

  async delete(id: ObjectId) {
    const bucket = await this.getBucket()
    return bucket.delete(id)
  }

  async drop() {
    const bucket = await this.getBucket()
    return bucket.drop()
  }

  async rename(id: ObjectId, filename: string) {
    const bucket = await this.getBucket()
    return bucket.rename(id, filename)
  }

  // Event methods as async (for compatibility, but not recommended)
  async on(event: string, listener: (...args: any[]) => void) {
    const bucket = await this.getBucket()
    return bucket.on(event, listener)
  }
  async once(event: string, listener: (...args: any[]) => void) {
    const bucket = await this.getBucket()
    return bucket.once(event, listener)
  }
  async off(event: string, listener: (...args: any[]) => void) {
    const bucket = await this.getBucket()
    return bucket.off(event, listener)
  }
  async addListener(event: string, listener: (...args: any[]) => void) {
    const bucket = await this.getBucket()
    return bucket.addListener(event, listener)
  }
  async removeListener(event: string, listener: (...args: any[]) => void) {
    const bucket = await this.getBucket()
    return bucket.removeListener(event, listener)
  }
  async removeAllListeners(event?: string) {
    const bucket = await this.getBucket()
    return bucket.removeAllListeners(event)
  }
  async emit<EventKey extends keyof EventsDescription>(
    event: EventKey | symbol,
    ...args: Parameters<EventsDescription[EventKey]>
  ): Promise<boolean> {
    const bucket = await this.getBucket()
    // Use apply to avoid TS spread argument linter error
    return bucket.emit([event, ...args] as any)
  }
  async listeners(event: string) {
    const bucket = await this.getBucket()
    return bucket.listeners(event)
  }
  async eventNames() {
    const bucket = await this.getBucket()
    return bucket.eventNames()
  }
  async setMaxListeners(n: number) {
    const bucket = await this.getBucket()
    return bucket.setMaxListeners(n)
  }
  async getMaxListeners() {
    const bucket = await this.getBucket()
    return bucket.getMaxListeners()
  }
  async listenerCount(event: string) {
    const bucket = await this.getBucket()
    return bucket.listenerCount(event)
  }
}
