/** @jsxImportSource hono/jsx */
import { actionUrl } from "$droplets/form";
import type { DropletActions, DropletProps } from "./$types";
import "./login.css";

// No JavaScript: a form, a cookie and a redirect, the oldest flow on the
// web. Never enhanced: the droplet ships no JavaScript, and a login is a
// navigation. Success redirects to `next`; a failure goes back to the host
// page (Post/Redirect/Get) with the signed result in its URL, and the card
// renders there again with its message (`form`).
export const ssr = true;
export const hydrate = false;

export default function Login({ data, form }: DropletProps) {
  // Server-rendered only: the render is always in progress here.
  const login = actionUrl<DropletActions>("login");
  const logout = actionUrl<DropletActions>("logout");
  const { next, admin } = data as Exclude<typeof data, Promise<unknown>>;
  const failed = form && "message" in form ? form.message : null;

  if (admin) {
    return (
      <section class="login">
        <h1>Admin</h1>
        <p>You are logged in as <b>{admin}</b>.</p>
        <div class="actions">
          <a class="button primary" href={next}>Go to admin</a>
          <form method="post" action={logout}><button class="button">Log out</button></form>
        </div>
      </section>
    );
  }

  return (
    <section class="login">
      <form method="post" action={login}>
        <h1>Admin login</h1>
        {failed ? <p class="notice error" role="alert">⚠ {failed}</p> : null}
        <label>
          User
          <input class="field" name="user" autocomplete="username" required maxlength={100} />
        </label>
        <label>
          Password
          <input class="field" name="password" type="password" autocomplete="current-password" required maxlength={200} />
        </label>
        <button class="button primary">Log in</button>
        <p class="hint">Demo credentials: admin / droplets</p>
      </form>
    </section>
  );
}
