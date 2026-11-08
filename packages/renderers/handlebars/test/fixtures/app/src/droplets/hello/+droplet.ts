export const load = ({ data }: { data: { who: string } }) => ({ ...data, greeting: `Hello ${data.who}!` });

export const handleError = ({ error }: { error: unknown }) => ({
  error: { message: `[hello] ${(error as { message?: string }).message ?? "?"}` },
});
