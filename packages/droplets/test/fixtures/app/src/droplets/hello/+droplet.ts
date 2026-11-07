import { browser } from "$droplets/env";

export const load = ({ data }: { data: { who: string } }) => {
  if (browser && data.who === "boom") throw new Error("browser boom");
  return { ...data, greeting: `Hello ${data.who}!` };
};

export const handleError = ({ error }: { error: unknown }) => ({
  error: { message: `[hello] ${(error as { message?: string }).message ?? "?"}` },
});
