import { useEffect, useState } from 'react'

/**
 * Returns the value after it has stayed unchanged for `delay` ms.
 *
 * Use for inline search inputs where each keystroke shouldn't fire a
 * network request. The component still re-renders on every change of
 * the immediate value (so the input remains controlled), but anything
 * that depends on the *debounced* value only reacts after the user
 * pauses typing.
 */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}
