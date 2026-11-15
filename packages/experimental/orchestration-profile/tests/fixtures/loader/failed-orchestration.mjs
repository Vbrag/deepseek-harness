/** Optional-plugin failure injected before any orchestration effects exist. */
export function apply() {
  throw new TypeError('orchestration startup probe failed')
}
