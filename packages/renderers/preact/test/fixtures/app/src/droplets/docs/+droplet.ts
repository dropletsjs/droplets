/** A hand-written Standard Schema: `page` coerced to a whole number, 1 by default. */
export const props = {
  "~standard": {
    version: 1 as const,
    vendor: "fixture",
    validate(value: unknown) {
      const page = Number((value as { page?: unknown }).page ?? 1);
      return Number.isInteger(page) && page > 0
        ? { value: { page } }
        : { issues: [{ message: "Expected a page number", path: ["page"] }] };
    },
  },
};
