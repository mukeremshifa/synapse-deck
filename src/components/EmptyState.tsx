/**
 * `EmptyState` moved into the state set at FR1.
 *
 * It is one of four states that must look identical everywhere, and keeping it
 * in its own file while the other three lived together is how the set would
 * have drifted apart again. FR1 §5.7 says fold it in rather than duplicate it —
 * so the component now lives in `states.tsx`, beside `LoadingState`,
 * `ErrorState` and `GeneratingState`, and this module re-exports it.
 *
 * The re-export exists because nine screens import from this path and rewriting
 * them all was not this phase's job — FR2–FR6 replace most of those screens
 * anyway, and each can import from `states` as it is rewritten. When the last
 * caller is gone, delete this file.
 */
export { EmptyState } from '@/components/states';
