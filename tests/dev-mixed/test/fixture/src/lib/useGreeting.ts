import { computed, ref } from "vue";

/** A Vue composable: a `use*()` call that React must leave alone. */
export function useGreeting(name: string) {
  const who = ref(name);
  return computed(() => `Vue greets ${who.value}`);
}
