`examples/hosts/aspnet`: an ASP.NET Core app (.NET 10, Razor Pages) that fetches droplet fragments with `HttpClient` from `IHttpClientFactory` into Razor pages and proxies the shop demo under its own origin.

## Rules

- The host app is standalone, since users copy it: it builds and runs from its own files and needs only the droplets servers' URLs in the environment. `docker-compose.yml` alone builds the droplets server and the shop from the repository root (`context: ../../..`).
- The host depends on the .NET SDK and published NuGet packages only, restored from its `packages.lock.json` files in locked mode, never on `packages/shared` or a workspace package; it talks to the droplets servers over HTTP.
- It is outside the pnpm workspace: the `dotnet` CLI with its own projects (`src/`, `test/`), and Docker Compose (`docker-compose.yml`), on the official `mcr.microsoft.com/dotnet` images of the current LTS.
- The shop flow passes against this compose stack with `pnpm test:hosts aspnet`.
  Checked by: `tests/hosts/e2e/shop.spec.ts`, run by `tests/hosts/run.mjs`.
- The host's own logic (the proxy's header and cookie allow-lists, its path and body checks, what a page inserts) has a test in `test/`, negative cases included; the image's build runs them.
  Checked by: `dotnet test` in `Dockerfile`.
- `x-droplet-location` is the configured public origin (`HostSettings.ShopOrigin`, `HostSettings.DropletsPublicUrl`, from `SHOP_PUBLIC_URL` and `DROPLETS_PUBLIC_URL`), never the request's Host.
  Checked by: `test/ProxyTests.cs`, `tests/hosts/test/location.test.ts`.
- In `docker-compose.yml`, the droplets server's `DROPLETS_TRUSTED_ORIGINS` lists `DROPLETS_URL` and this host's `WEB_URL`; the shop's lists `WEB_URL`.
  Checked by: `tests/hosts/e2e/shop.spec.ts`.
- The proxy forwards only the listed request headers, none that names a host, and passes `Set-Cookie`, redirects and bodies back untouched.
  Checked by: `test/ProxyTests.cs`, `tests/hosts/e2e/shop.spec.ts`.
- The clients' handler keeps no cookies and follows no redirects: each visitor's `Cookie` is forwarded as it came.
  Checked by: `test/ProxyTests.cs`, `tests/hosts/e2e/shop.spec.ts` ("a new visitor gets nobody else's cart or session").
- A shop page inserts a fragment only when it is a 2xx, 500 or 504 `text/html` answer, with `Html.Raw`; everything else goes through Razor's encoding.
  Checked by: `test/PageTests.cs`.
- Published ports bind to `127.0.0.1` only.
- `src/wwwroot/shop.css` is the same file as the other hosts' `shop.css` (all but WordPress); a change goes to all of them.
  Checked by: `tests/hosts/test/shop-css.test.ts`.
- `apps/docs/src/content/docs/integrate/hosts/aspnet.mdx` states what this host does.
- Comments explain a non-obvious why.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).
