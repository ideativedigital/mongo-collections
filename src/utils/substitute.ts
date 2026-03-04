const isInstanceOfAnyClass = (obj: any): boolean => {
    return obj != null && typeof obj === 'object' && obj.constructor !== Object
}

type Rule = { condition: (r: any) => boolean; replace: (r: any) => any }

function deepTraverse(obj: any, tryReplace: (value: any) => any): any {
    const replaced = tryReplace(obj)
    if (replaced !== undefined) return replaced
    if (Array.isArray(obj)) return obj.map((o) => deepTraverse(o, tryReplace))
    if (isInstanceOfAnyClass(obj)) return obj
    if (obj && typeof obj === 'object') {
        return Object.fromEntries(
            Object.entries(obj).map(([key, value]) => [key, deepTraverse(value, tryReplace)])
        )
    }
    return obj
}

function tryRules(value: any, rules: readonly Rule[]): any {
    for (const { condition, replace } of rules) {
        if (condition(value)) return replace(value)
    }
    return undefined
}

function withAnd(fn: (obj: any) => any): Substituer {
    return Object.assign(fn, {
        and: (substituer: Substituer) => withAnd((obj: any) => substituer(fn(obj))),
    })
}

export type Substituer = ((input: any) => any) & {
    and: (substituer: Substituer) => Substituer
}

/**
 * Substitute the object with the new object (deep traversal).
 * @param condition - The condition to check if the object is of the type T
 * @param replace - The function to replace the object with the new object
 * @returns A Substituer that can be chained with `.and(otherSubstituer)`
 */
export const substitute = <T, U>(
    condition: (r: any) => r is T,
    replace: (r: any) => U
): Substituer => {
    const rules: Rule[] = [{ condition, replace }]
    const funct = (obj: any): any =>
        deepTraverse(obj, (value) => tryRules(value, rules))
    return withAnd(funct)
}

export type SubstituteBuilderApi = {
    /** Add a rule: when condition matches, replace with replace(value). First matching rule wins per value. */
    when: <T, U>(condition: (r: any) => r is T, replace: (r: T) => U) => SubstituteBuilderApi
    /** Compose with another substituer: result = other(built(obj)). */
    then: (substituer: Substituer) => SubstituteBuilderApi
    /** Build the Substituer. */
    build: () => Substituer
}

/**
 * Build a complex substituer from multiple rules and optional composition.
 * Rules are tried in order for each value during deep traversal; first match wins.
 *
 * @example
 * const s = substituteBuilder()
 *   .when((x): x is Date => x instanceof Date, (d) => d.toISOString())
 *   .when((x): x is RegExp => x instanceof RegExp, (r) => r.source)
 *   .then(substitute((x): x is Map<string, unknown> => x instanceof Map, (m) => Object.fromEntries(m)))
 *   .build()
 */
export function substituteBuilder(): SubstituteBuilderApi {
    const rules: Rule[] = []
    let thenSubstituer: Substituer | null = null

    const api: SubstituteBuilderApi = {
        when<T, U>(condition: (r: any) => r is T, replace: (r: T) => U) {
            rules.push({ condition, replace })
            return api
        },
        then(substituer: Substituer) {
            thenSubstituer = thenSubstituer ? withAnd((obj: any) => substituer(thenSubstituer!(obj))) : substituer
            return api
        },
        build() {
            const base = (obj: any): any =>
                deepTraverse(obj, (value) => tryRules(value, rules))
            const substituer = withAnd(thenSubstituer ? (obj: any) => thenSubstituer!(base(obj)) : base)
            return substituer
        },
    }
    return api
}