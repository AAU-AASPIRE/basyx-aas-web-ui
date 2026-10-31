import type { Ref } from 'vue'

const flags = new Map<string, Ref<boolean>>()

/**
 * A yes or no kept per browser under ``key``, and shared: every component that asks for the same key
 * gets the same ref, so two editors on one page follow each other.
 */
export function useKeptFlag (key: string): Ref<boolean> {
  const known = flags.get(key)
  if (known) {
    return known
  }
  const flag = ref(read(key))
  watch(flag, value => {
    try {
      localStorage.setItem(key, String(value))
    } catch {
      // Not kept: the choice holds for this page.
    }
  })
  flags.set(key, flag)
  return flag
}

function read (key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}
