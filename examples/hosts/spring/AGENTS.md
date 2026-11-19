`examples/hosts/spring`: a Spring Boot app (Spring MVC, Thymeleaf) that fetches droplet fragments with `RestClient` into Thymeleaf templates and proxies the shop demo under its own origin.

## Rules

- The host app is standalone, since users copy it: it builds and runs from its own files and needs only the droplets servers' URLs in the environment. `docker-compose.yml` alone builds the droplets server and the shop from the repository root (`context: ../../..`).
- The host depends on published Maven artifacts only (`pom.xml`, the Spring Boot parent), never on `packages/shared` or a workspace package; it talks to the droplets servers over HTTP.
- It is outside the pnpm workspace: Maven with its own `pom.xml`, built and tested inside Docker (`Dockerfile`, a multi-stage build on JDK 25), and Docker Compose (`docker-compose.yml`).
- `mvn package` runs `src/test` first, so a failing test stops the image build. What the host decides itself (the cookie filter, the dot-segment and body-size refusals, the `Link` filter, the escaped note) has a negative test there.
  Checked by: `src/test/java/com/example/droplets/ShopTest.java`, run by the `Dockerfile`.
- The shop flow passes against this compose stack with `pnpm test:hosts spring`.
  Checked by: `tests/hosts/e2e/shop.spec.ts`, run by `tests/hosts/run.mjs`.
- `x-droplet-location` is the configured public origin (`DROPLETS_PUBLIC_URL`, `SHOP_PUBLIC_URL`), never the request's Host.
  Checked by: `tests/hosts/e2e/shop.spec.ts`, `tests/hosts/test/location.test.ts`.
- In `docker-compose.yml`, the droplets server's `DROPLETS_TRUSTED_ORIGINS` lists `DROPLETS_URL` and this host's `WEB_URL`; the shop's lists `WEB_URL`.
  Checked by: `tests/hosts/e2e/shop.spec.ts`.
- The proxy forwards only the listed request headers, none that names a host, and passes `Set-Cookie`, redirects and bodies back untouched. Nothing reads a request body before it (`spring.servlet.multipart.enabled=false`, `spring.mvc.formcontent.filter.enabled=false`).
  Checked by: `tests/hosts/e2e/shop.spec.ts`.
- The shared `RestClient` (JDK `HttpClient`) has no cookie handler and follows no redirects: each visitor's `Cookie` is forwarded as it came.
  Checked by: `tests/hosts/e2e/shop.spec.ts` ("a new visitor gets nobody else's cart or session").
- A shop page inserts a fragment (`th:utext`) only when it is a 2xx or 500 `text/html` answer; every other value goes through `th:text` or `HtmlUtils.htmlEscape`.
- Published ports bind to `127.0.0.1` only.
- `src/main/resources/static/shop.css` is the same file as the other hosts' `shop.css` (all but WordPress); a change goes to all of them.
  Checked by: `tests/hosts/test/shop-css.test.ts`.
- `apps/docs/src/content/docs/integrate/hosts/spring.mdx` states what this host does.
- Comments explain a non-obvious why.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).
