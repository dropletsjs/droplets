# Security policy

## Supported versions

Only the latest release gets security fixes; upgrade to it before reporting.

## Reporting a vulnerability

Report privately through GitHub's private vulnerability reporting: open the
repository's **Security** tab and choose **Report a vulnerability**
(https://github.com/dropletsjs/droplets/security/advisories/new).

Please do not open a public issue, pull request or discussion for a security
problem.

Include what you can of:

- the affected package(s) and version(s), and the adapter (node, cloudflare,
  bun, deno);
- what an attacker can do, and under which conditions;
- a minimal reproduction: a droplet, an endpoint or a sequence of requests;
- any fix or mitigation you have in mind.

## What to expect

Droplets is a small project, so this is best effort. We aim to acknowledge a
report within a week, keep you posted while we work on it, and credit you in
the advisory unless you prefer otherwise. Please give us a reasonable time to
release a fix before you disclose.

## Scope

These areas are security-sensitive, and reports about them are especially
welcome:

- **Form actions and the PRG token.** The redirect-after-post token is signed
  with HMAC using `DROPLETS_SECRET`. Forging, replaying or leaking it, or
  getting an action to run without a valid one, is in scope.
- **Endpoint input handling.** Droplet routes, `/_data`, form actions and
  `+server.ts` endpoints take props, query strings and bodies as plain data.
  Prototype pollution, module or code resolution driven by input, and anything
  else that turns request data into more than data are in scope.
- **The server-only files guard.** `*.server.*` files and anything under
  `server/` must never reach a client bundle, in `vite build` or in `vite dev`.
  Any way to get their code or their values to the browser is in scope.
- **The embedding and proxy contract.** How a host fetches a fragment
  (`x-droplet-location` and the other request headers), how `/index.js` and
  the assets are served across origins, and what a host has to trust about
  the fragment it pastes in.

Example host stacks under `examples/hosts` are demos, not hardened deployments.
