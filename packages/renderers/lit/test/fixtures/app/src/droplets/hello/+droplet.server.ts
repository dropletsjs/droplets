export const load = ({ props }: { props: Record<string, unknown> }) => {
  const who = typeof props["who"] === "string" ? props["who"] : "world";
  if (who === "crash") throw new Error("Asked to crash.");
  return { greeting: `Hello ${who}!` };
};

export const handleError = () => ({ error: { message: "Sorry, ref 42" } });

export const actions = {
  default: async ({ request }: { request: Request }) => ({ message: `Thanks, ${(await request.formData()).get("name")}` }),
};
