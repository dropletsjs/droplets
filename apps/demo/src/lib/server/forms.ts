// Reading a form body as plain data: one field at a time, by name, checked
// for its type and length. Nothing from the body is merged into anything,
// and a File where a string is expected is a missing field.

/** A form body, or `null` when it cannot be read as one. */
export async function readForm(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

/** The field's trimmed text when it is a string of at most `max` characters, else `null`. */
export function text(form: FormData, name: string, max: number): string | null {
  const value = form.get(name);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : null;
}
