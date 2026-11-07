import { building } from "$droplets/env";
import { error, type LoadEvent, type TransformEvent } from "$droplets/server";

// "1" and 1 are the same page once the schema has run: one render. Page 99
// fails and is stored as its error page; page 404 answers error() and is not
// stored. Page 5 is rendered for one host only. Page 7 reads more of `host`
// than a build without one knows: it renders live only.
export const entries = () => [
  { props: { page: "1" } },
  { props: { page: 2 } },
  { props: { page: 1 } },
  { props: { page: 99 } },
  { props: { page: 404 } },
  { props: { page: 5 }, host: "https://fixed.test/docs" },
];

export const load = ({ props, locals, host, setHeaders }: LoadEvent) => {
  // Page 2 is the same for everyone: cacheable, prerendered with that header.
  if (props["page"] === 2) setHeaders({ "cache-control": "public, max-age=60" });
  if (props["page"] === 404) error(404, "No such page");
  if (props["page"] === 99) throw new Error("page 99 is broken");
  const ref = props["page"] === 7 ? host.searchParams.get("ref") : null;
  // At build without a host, a token the server replaces per request.
  return {
    page: props["page"],
    building,
    hooked: locals["hooked"] === true,
    home: `${host.origin}/home`,
    ...(ref ? { ref } : {}),
  };
};

export const handleError = () => ({ error: { message: "This page is unavailable" } });

export const transform = ({ html, host }: TransformEvent) => html.replace("@HOST@", host.host);
