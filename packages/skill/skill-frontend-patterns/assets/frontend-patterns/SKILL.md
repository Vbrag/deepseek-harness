---
name: frontend-patterns
description: Frontend and GUI authoring patterns for React and Next.js — component composition, custom hooks, state management, performance, animation, and accessibility. Load when writing or editing component, hook, or state code in a web or desktop GUI codebase.
---

# Frontend and GUI authoring patterns

Use these patterns when writing or editing frontend or GUI code in a React, Next.js, or React-ecosystem codebase — components, custom hooks, state management, performance optimizations, animations, and accessibility. The patterns are framework-agnostic in intent; choose ones that fit the project's complexity rather than applying every pattern everywhere.

## Component patterns

### Composition over inheritance

Compose small, single-purpose components instead of building deep inheritance trees.

```tsx
interface CardProps { children: React.ReactNode; variant?: 'default' | 'outlined' }
export function Card({ children, variant = 'default' }: CardProps) {
  return <div className={`card card-${variant}`}>{children}</div>
}
```

Keep layout and presentation separate: a `CardHeader`, `CardBody`, and `Card` that composes them, used as `<Card><CardHeader>…</CardHeader><CardBody>…</CardBody></Card>`. This keeps each component small, testable, and reusable.

### Compound components

Pair a provider component with child `Tab`/`Item` components that read shared context, giving callers a familiar `<Tabs>`/`<Tab>` API while sharing state through context.

```tsx
const TabsContext = createContext<{ active: string; setActive: (id: string) => void } | undefined>(undefined)
export function Tabs({ children, defaultTab }: { children: React.ReactNode; defaultTab: string }) {
  const [active, setActive] = useState(defaultTab)
  return <TabsContext.Provider value={{ active, setActive }}>{children}</TabsContext.Provider>
}
export function useTabs() {
  const ctx = useContext(TabsContext)
  if (!ctx) throw new Error('useTabs must be used within Tabs')
  return ctx
}
```

Validate children inside the provider context and `throw` with a descriptive message when a child is used outside its provider — this fails fast at development time.

### Render props

Pass rendering control to the caller through a function child when a component differs only in how it presents fetched or derived data. Prefer children-as-function only when the data shape varies; otherwise keep a default render.

## Custom hook patterns

- **`useToggle`**: a small boolean toggle with a stable `toggle` callback.
- **`useDebounce(value, delay)`**: returns a value that only updates after `delay` ms of no change; useful for search inputs. Always return the cleanup `clearTimeout`.
- **`useQuery` / data-fetching hook**: expose `{ data, error, loading, refetch }` and accept `onSuccess`/`onError`/`enabled` options. Wrap the fetcher in `useCallback` so callers can pass stable functions; never mutate state during render.

Return **stable callbacks** (`useCallback`) and **memoized values** (`useMemo`) from custom hooks so consumers can depend on them without re-running effects.

## State management patterns

### Context + reducer

For medium shared state, combine a `useReducer` with a context provider.

```tsx
type Action = { type: 'SET_ITEMS'; payload: Item[] } | { type: 'SET_LOADING'; payload: boolean }
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_ITEMS': return { ...state, items: action.payload }
    case 'SET_LOADING': return { ...state, loading: action.payload }
  }
}
```

- Use **functional updates** (`setCount(prev => prev + 1)`) whenever the next state depends on the previous state.
- Avoid prop drilling across more than a couple of layers; extract a context or custom hook instead.
- Split the reducer into a discriminated-union `Action` type for exhaustive `switch` handling; add a default that returns the unchanged state so new actions fail the type check loudly.
- Resolve state ownership before adding a store: prefer server state kept by the data layer, and lift client state only when genuinely shared.

## Performance patterns

- **Memoize expensive derived values** with `useMemo`, keyed by the exact inputs they depend on.
- **Stabilize callbacks** passed to memoized children with `useCallback`.
- **Memoize pure presentational components** with `React.memo`.
- **Lazy-load heavy components** with `React.lazy` + `Suspense`, with a visible fallback for user-perceived loading.
- **Virtualize long lists** (hundreds to thousands of rows) so only visible rows render. Use a virtualization library or measure the viewport and slice the list; keep row heights stable and a bounded overscan.
- Do not memoize early: profile first, and only optimize measured hot paths. An unnecessary `useMemo`/`React.memo` on a cheap subtree can cost more than it saves.

## Form handling patterns

- Keep one controlled state object per form and one `validate()` pass that returns an error map.
- Validate on submit (and optionally per-field on blur), show inline field errors, and block submit while invalid.
- Derive the error map purely from the current values so it re-renders correctly without stale closures.

## Animation patterns

- Use a motion library (for example Framer Motion) for enter/exit and layout animations.
- Wrap list enter/exit with an `AnimatePresence`-style container so removals animate too.
- Keep animations short (roughly 200–400 ms), respect `prefers-reduced-motion`, and never animate layout-critical data reads.
- Prefer CSS transitions for simple state changes and reserve the motion library for orchestrating mount/unmount and interdependencies.

## Error boundary pattern

Wrap interactive subtrees with an error boundary that catches render-phase errors, renders a recoverable fallback, and gives the user a way to dismiss to `hasError: false`.

```tsx
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  render() {
    if (this.state.hasError) return <Fallback onReset={() => this.setState({ hasError: false })} />
    return this.props.children
  }
}
```

## Accessibility patterns

- **Keyboard navigation**: implement ArrowUp/ArrowDown/Enter/Escape handling for dropdowns, menus, and listboxes, and manage an `activeIndex` explicitly.
- **Focus management**: on modal open, save `document.activeElement` and focus the dialog; on close, restore focus. Set `tabIndex={-1}` and `role="dialog"`/`aria-modal="true"` on the dialog container.
- Expose live regions (`aria-live`) for async status changes and `aria-expanded`/`aria-haspopup` on disclosure controls.
- Ensure every interactive control is reachable and operable by keyboard alone, and visible focus is never removed.

## When to use in a DeepSeek Harness codebase

When contributing GUI code, the patterns above complement, and do not replace, the harness-specific review and layout guidance. Read those skills before shipping UI work; this skill supplies the how-to-author component, hook, state, and performance mechanics, while the review and responsive skills govern the harness client's visual and interaction standards.

## Guidance specific to authoring

- **Start from the component's contract** (props and data) before choosing a pattern; the pattern follows the shape of the data.
- **Keep each pattern shallow**: a component or hook that grows beyond a few dozen lines usually signals that a larger pattern (compound components, context, virtualization) is needed, not longer functions.
- **Test user-visible behavior, not implementation details**: assert on rendered text and roles rather than internal state or class names.
