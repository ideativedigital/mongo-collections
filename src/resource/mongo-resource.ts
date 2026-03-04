import { BadParametersError, DuplicateError, NotFoundError } from '@/errors'
import { Filter, UpdateFilter } from 'mongodb'
import { NextRequest, NextResponse } from 'next/server'
import { Collection } from '../mongo-collection'

/** Handler function signature for HTTP methods in Next.js App Router. */
type MethodHandler = (request: NextRequest, provided: any) => Promise<Response>

export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD'
/**
 * Default error handler that maps domain errors to HTTP responses.
 * - {@link NotFoundError} → 404
 * - {@link BadParametersError} → 400
 * - {@link DuplicateError} → 409
 * - Other errors → 500
 */
export const defaultErrorHandler = (error: unknown) => {
    if (error instanceof NotFoundError) {
        return NextResponse.json({ error: error.message }, { status: 404 })
    }
    else if (error instanceof BadParametersError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
    }

    else if (error instanceof DuplicateError) {
        return NextResponse.json({ error: error.message }, { status: 409 })
    }
    else {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}

/** Extracts the `_id` type from a Collection's document type, defaulting to `string`. */
type idType<Col extends Collection<any>> = Col extends Collection<infer T> ? T['_id'] extends undefined ? string : T['_id'] : string

/**
 * Configuration options for {@link MongoResource}.
 * All options are optional; defaults use the collection's built-in methods.
 */
export type Options<Col extends Collection<any>> = {

    /**
     * Wrap the request before handling it.
     * @default `undefined`
     */
    wrapper?: (fn: (
        req: NextRequest,
        context: { resource: Promise<string[]> }) => Promise<Response>) => (request: NextRequest, params: { resource: Promise<string[]> }) => Promise<Response>
    /**
     * Validate the request before handling it.
     * @default `undefined`
     */
    validateRequest?: (request: NextRequest, resource: string[], method: HTTPMethod) => Promise<void> | void | Response | Promise<Response>
    /**
     * Parse the `id` segment from the URL path into the document's id type.
     * @default identity function (returns the string as-is)
     */
    parseId?: (id: string) => idType<Col>

    /**
     * Convert URL search params to a MongoDB filter for GET (list) requests.
     * @default empty filter `{}`
     */
    searchParamsToFilter?: (searchParams: URLSearchParams) => Filter<Col['Type']> | Promise<Filter<Col['Type']>>

    /**
     * Parse and validate the request body for PUT (update) requests.
     * Also used for POST if `parseCreationPayload` is not provided.
     */
    parsePayload?: (payload: any, col: Col, request: NextRequest) => Partial<Col['Type']>

    /**
     * Convert the parsed payload to an update filter for PUT (update) requests.
     * @default `{ $set: payload }` (then transformed by collection mapper/substituer)
     */
    payloadToUpdate?: (payload: any, col: Col, request: NextRequest) => UpdateFilter<Col['Type']>

    /**
     * Parse and validate the request body specifically for POST (create) requests.
     * Falls back to `parsePayload` if not provided.
     */
    parseCreationPayload?: (payload: any, col: Col, request: NextRequest) => Col['Type'] | Promise<Col['Type']>

    /**
     * Custom handler for GET with an id (single resource).
     * @default `col.getById(id)`
     */
    findOne?: (id: idType<Col>, col: Col, request: NextRequest) => Promise<Col['Type'] | null>

    /**
     * Custom handler for HEAD with an id (single resource).
     * @default `col.existsById(id)`
     */
    exists?: (id: idType<Col>, col: Col, request: NextRequest) => Promise<boolean>

    /**
     * Custom handler for GET without an id (list resources).
     * @default `col.find(filter)`
     */
    getAll?: (filter: Filter<Col['Type']>, col: Col, request: NextRequest) => Promise<Col['Type'][]> | Response | Promise<Response>

    /**
     * Custom handler for POST (create resource).
     * @default `col.insert(payload)`
     */
    create?: (
        payload: Omit<Col['Type'], '_id'>,
        col: Col,
        request: NextRequest
    ) => Promise<Col['Type']> | Response | Promise<Response>

    /**
     * Custom handler for POST bulk (create multiple resources).
     * @default `col.insertMany(payloads)`
     */
    createBulk?: (
        payloads: Omit<Col['Type'], '_id'>[],
        col: Col,
        request: NextRequest
    ) => Promise<Col['Type'][]> | Response | Promise<Response>

    /**
     * Custom handler for PUT (update resource).
     * @default `col.updatebyId(id, payload)`
     */
    update?: (
        id: idType<Col>,
        payload: Omit<Col['Type'], '_id'>,
        col: Col,
        request: NextRequest
    ) => Promise<Col['Type']> | Response | Promise<Response>

    /**
     * Custom handler for DELETE (remove resource).
     * @default `col.deleteById(id)`
     */
    delete?: (id: idType<Col>, col: Col, request: NextRequest) => Promise<void> | Response | Promise<Response>

    /**
     * Custom error handler. Receives any thrown error and returns a Response.
     * @default {@link defaultErrorHandler}
     */
    errorHandler?: (error: unknown) => Promise<Response> | Response
}
/**
 * Creates a RESTful resource handler for a MongoDB collection in Next.js App Router.
 *
 * Returns an object with `GET`, `POST`, `PUT`, and `DELETE` handlers that can be
 * exported directly from a `route.ts` file.
 *
 * @example
 * // app/api/users/[...resource]/route.ts
 * import { MongoResource } from 'mongo-collections/resource'
 * import { usersCollection } from '@/db'
 *
 * export const { GET, POST, PUT, DELETE } = MongoResource(usersCollection, {
 *   parseId: (id) => new ObjectId(id),
 *   searchParamsToFilter: (params) => {
 *     const name = params.get('name')
 *     return name ? { name: { $regex: name, $options: 'i' } } : {}
 *   },
 * })
 *
 * @param col - The mongo-collections Collection instance
 * @param opts - Optional configuration for parsing, custom handlers, and error handling
 * @returns Object with GET, POST, PUT, DELETE method handlers
 */
export function MongoResource<Col extends Collection<any>>(
    col: Col,
    opts?: Options<Col>
): { GET: MethodHandler; POST: MethodHandler; PUT: MethodHandler; DELETE: MethodHandler; PATCH: MethodHandler; OPTIONS: MethodHandler; HEAD: MethodHandler } {
    // Default parseId is identity (string → string)
    const parseId: (id: string) => idType<Col> = opts?.parseId || ((id: string) => id) as any

    /**
     * Wraps a handler function with JSON response serialization and error handling.
     * Awaits the `resource` path segments from Next.js dynamic route params.
     * If the handler returns a Response, it is returned as-is; otherwise the result is JSON-serialized.
     */
    const methodHandlerWrapper = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD', fn: ((request: NextRequest, resource: string[]) => Promise<any>)): MethodHandler => {
        const funct = async (request: NextRequest, params: { resource: Promise<string[]> }) => {
            const resource = await params.resource
            try {
                if (opts?.validateRequest) {
                    const result = await opts.validateRequest(request, resource, method)
                    // If validateRequest returns a Response, use it (e.g., for custom error responses)
                    if (result instanceof Response) return result
                    // Otherwise, validation passed - continue to the handler
                }
                const res = await fn(request, resource)
                // If handler already returned a Response (e.g. error response), return it directly
                if (res instanceof Response) return res
                if (typeof res === 'undefined') return new Response(undefined, { status: 204 })
                return NextResponse.json(res)
            } catch (error) {
                console.error(error)
                if (opts?.errorHandler)
                    return opts.errorHandler(error)
                else {
                    const response = defaultErrorHandler(error)

                    return response
                }

            }
        }
        if (opts?.wrapper) {
            return opts.wrapper(funct)
        }
        return funct
    }

    return {
        /**
         * GET handler.
         * - With id segment (`/resource/123`): returns single document via `findOne` or `col.getById`.
         * - Without id (`/resource`): returns list via `getAll` or `col.find` with optional filter from search params.
         */
        GET: methodHandlerWrapper('GET', async (request, resource) => {
            if (resource.length > 0) {
                // Single resource by id
                const id = parseId(resource[0])
                console.log('id', id)
                if (opts?.findOne) {
                    try {
                        return opts.findOne(id, col, request)
                    } catch (error) {
                        return new Response('Not Found', { status: 404 })
                    }
                }
                return col.getById(id)
            } else {
                // List resources with optional filter
                const filter = opts?.searchParamsToFilter ? await opts.searchParamsToFilter(request.nextUrl.searchParams) : {}
                return opts?.getAll ? opts.getAll(filter, col, request) : col.find(filter)
            }
        }),

        /**
         * POST handler (create).
         * - if the first segment is 'bulk', (POST /[resource]/bulk) it will create multiple resources.
         * - otherwise Only valid at collection root (`/resource`); returns 404 if id segment present.
         * - Parses body via `parseCreationPayload` or `parsePayload`, then inserts.
         */
        POST: methodHandlerWrapper('POST', async (request, resource) => {
            if (resource.length === 1 && resource[0] === 'bulk') {
                const body = await request.json()
                if (!Array.isArray(body)) {
                    throw new BadParametersError('Request body must be an array', col.name)
                }
                const payloads = await Promise.all(body.map((item: any) =>
                    opts?.parseCreationPayload ? opts.parseCreationPayload(item, col, request) : opts?.parsePayload ? opts.parsePayload(item, col, request) : Promise.resolve(item)
                ))
                if (opts?.createBulk) return opts.createBulk(payloads, col, request)
                await col.insertMany(payloads)
                return NextResponse.json(payloads, { status: 201 })
            }
            if (resource.length > 0) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
            const body = await request.json()
            const payload = await (opts?.parseCreationPayload ? opts.parseCreationPayload(body, col, request) : opts?.parsePayload ? opts.parsePayload(body, col, request) : body)
            if (opts?.create) return opts.create(payload, col, request)
            return NextResponse.json(await col.insert(payload), { status: 201 })
        }),

        /**
         * PUT handler (update).
         * - Requires exactly one id segment (`/resource/123`); returns 405 if missing, 404 if extra segments.
         * - Parses body via `parsePayload`, then updates by id.
         */
        PUT: methodHandlerWrapper('PUT', async (request, resource) => {
            if (resource.length === 0) return NextResponse.json({ error: 'unauthorized method' }, { status: 405 })
            if (resource.length > 1) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
            const body = await request.json()
            const payload = opts?.parsePayload ? opts.parsePayload(body, col, request) : body
            const updateFilter = opts?.payloadToUpdate ? opts.payloadToUpdate(payload, col, request) as UpdateFilter<any> : { $set: payload } as UpdateFilter<any>
            if (opts?.update) return opts.update(parseId(resource[0]), payload, col, request)
            return col.getAndUpdateById(parseId(resource[0]), updateFilter)
        }),

        /**
         * PATCH handler (partial update).
         * - Requires exactly one id segment (`/resource/123`); returns 405 if missing, 404 if extra segments.
         * - Parses body via `parsePayload`, then updates by id using `$set`.
         */
        PATCH: methodHandlerWrapper('PATCH', async (request, resource) => {
            if (resource.length === 0) return NextResponse.json({ error: 'unauthorized method' }, { status: 405 })
            if (resource.length > 1) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
            const body = await request.json()
            const payload = opts?.parsePayload ? opts.parsePayload(body, col, request) : body
            const updateFilter = opts?.payloadToUpdate ? opts.payloadToUpdate(payload, col, request) as UpdateFilter<any> : { $set: payload } as UpdateFilter<any>
            if (opts?.update) return opts.update(parseId(resource[0]), payload, col, request)
            return col.getAndUpdateById(parseId(resource[0]), updateFilter)
        }),

        /**
         * DELETE handler.
         * - Requires exactly one id segment (`/resource/123`); returns 405 if missing, 404 if extra segments.
         * - Deletes document by id.
         */
        DELETE: methodHandlerWrapper('DELETE', async (request, resource) => {
            if (resource.length === 0) return NextResponse.json({ error: 'unauthorized method' }, { status: 405 })
            if (resource.length > 1) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
            const id = parseId(resource[0])
            if (opts?.delete) return opts.delete(id, col, request)
            return col.deleteById(id)
        }),
        /**
         * OPTIONS handler.
         * - At collection root (`/resource`): returns 204 with `Allow: GET, POST, OPTIONS`.
         * - At single resource (`/resource/123`): returns 204 with `Allow: GET, PUT, PATCH, DELETE, HEAD, OPTIONS`.
         * - Extra segments: returns 404.
         */
        OPTIONS: methodHandlerWrapper('OPTIONS', async (request, resource) => {
            if (resource.length === 0) return new Response(undefined, { status: 204, headers: { 'Allow': 'GET, POST, OPTIONS' } })
            if (resource.length === 1) return new Response(undefined, { status: 204, headers: { 'Allow': 'GET, PUT, PATCH, DELETE, HEAD, OPTIONS' } })
            return new Response(undefined, { status: 404 })
        }),
        /**
         * HEAD handler.
         * - Requires exactly one id segment (`/resource/123`); returns 405 if missing, 404 if extra segments.
         * - Returns 200 if document exists, 404 otherwise.
         */
        HEAD: methodHandlerWrapper('HEAD', async (request, resource) => {
            if (resource.length === 0) return NextResponse.json({ error: 'unauthorized method' }, { status: 405 })
            if (resource.length > 1) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
            const id = parseId(resource[0])
            if (opts?.exists) {
                if (await opts.exists(id, col, request)) {
                    return new Response(undefined, { status: 200 })
                }
                return new Response(undefined, { status: 404 })
            }
            if (await col.exists({ id })) {
                return new Response(undefined, { status: 200 })
            }
            return new Response(undefined, { status: 404 })
        }),
    }
}
