type PartialEmitter = {
  once(event: string, callback: (...args: unknown[]) => void): unknown
  removeListener(event: string, callback: (...args: unknown[]) => void): unknown
}

export const NO_RESOLVE = Symbol('NO_RESOLVE')

export function waitForEvent<A extends Array<unknown>, O = unknown>(
  emitter: PartialEmitter,
  eventName: string,
  resolver: (...args: A) => O,
  ms = 500
): Promise<O> {
  type L = (...args: unknown[]) => void
  return new Promise<O>((resolve, reject) => {
    const listener = (...args: A) => {
      const value = resolver(...args)
      if (value === NO_RESOLVE) {
        return
      }
      resolve(value)
    }
    emitter.once(eventName, listener as L)
    setTimeout(() => {
      emitter.removeListener(eventName, listener as L)
      reject(new Error(`not resolved after ${ms}ms`))
    }, ms)
  })
}
