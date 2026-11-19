`examples/hosts/go`: a Go server on the standard library alone that fetches droplet fragments with `net/http` into `html/template` pages and proxies the shop demo under its own origin.

## Rules

- The host app is standalone, since users copy it: it builds and runs from its own files and needs only the droplets servers' URLs in the environment. `docker-compose.yml` alone builds the droplets server and the shop from the repository root (`context: ../../..`).
- It uses the Go standard library only: `go.mod` has no `require`, and never names `packages/shared` or a workspace package; it talks to the droplets servers over HTTP.
- It is outside the pnpm workspace: the Go toolchain inside Docker (`golang` build stage, a distroless image that runs the binary), and Docker Compose (`docker-compose.yml`).
- `go vet` and `go test` pass in the image's build stage; logic of the host's own (the proxy's refusals, the header list, what a page inserts) has a test in `shop_test.go`, a refusal with a negative one.
  Checked by: `Dockerfile` (`docker compose up --build` fails on a failing test).
- The shop flow passes against this compose stack with `pnpm test:hosts go`.
  Checked by: `tests/hosts/e2e/shop.spec.ts`, run by `tests/hosts/run.mjs`.
- `x-droplet-location` is the configured public origin (`DROPLETS_PUBLIC_URL`, `SHOP_PUBLIC_URL`), never the request's Host.
  Checked by: `tests/hosts/e2e/shop.spec.ts`, `tests/hosts/test/location.test.ts`, `shop_test.go`.
- In `docker-compose.yml`, the droplets server's `DROPLETS_TRUSTED_ORIGINS` lists `DROPLETS_URL` and this host's `WEB_URL`; the shop's lists `WEB_URL`.
  Checked by: `tests/hosts/e2e/shop.spec.ts`.
- The proxy forwards only the listed request headers, none that names a host, refuses a dot segment, a method off its list and a body over `maxBodyBytes`, and passes `Set-Cookie`, redirects and bodies back untouched.
  Checked by: `shop_test.go`, `tests/hosts/e2e/shop.spec.ts`.
- The shared `http.Client` has no cookie jar and follows no redirects: each visitor's `Cookie` is forwarded as it came.
  Checked by: `shop_test.go`, `tests/hosts/e2e/shop.spec.ts` ("a new visitor gets nobody else's cart or session").
- A page inserts a fragment only when it is a 2xx or 500 `text/html` answer, as `template.HTML`; nothing else from a request becomes `template.HTML` unescaped.
  Checked by: `shop_test.go`.
- Published ports bind to `127.0.0.1` only.
- `static/shop.css` is the same file as the other hosts' `shop.css` (all but WordPress); a change goes to all of them.
  Checked by: `tests/hosts/test/shop-css.test.ts`.
- `apps/docs/src/content/docs/integrate/hosts/go.mdx` states what this host does.
- Go code is `gofmt`ed; comments explain a non-obvious why.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).
