

export const MongoErrors = {
  DUPLICATE_KEY: 11000,
  WRITE_CONFLICT: 112
}

export class NotFoundError extends Error {
  constructor(readonly element: string, readonly collectionName: string) {
    super(`${element} not found in ${collectionName}`)
  }
}

export class DuplicateError extends Error {
  constructor(readonly element: string, readonly collectionName: string) {
    super(`${element} already exists in ${collectionName}`)
  }
}

export class BadParametersError extends Error {
  constructor(readonly reason: string, readonly collectionName: string) {
    super(`${reason} in ${collectionName}`)
  }
}
