// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  actionAnswer,
  type DropletActionDetail,
  enhanceDropletForm,
  ownAction,
  redirectTarget,
  submission,
} from "../../src/runtime/enhance.ts";

const LOCATION = "https://drops.test/mfe";
const OWN = `${LOCATION}/droplets/guestbook`;

/** A stand-in for the droplet element: where its actions are, and what it was asked to render. */
class Host extends HTMLElement {
  forms: unknown[] = [];
  actionTarget() {
    return { droplet: this.dataset["droplet"] ?? "", location: LOCATION };
  }
  async updateForm(form: unknown) {
    this.forms.push(form);
  }
}
customElements.define("enhance-host", Host);

const at = (action: string) => ownAction(new URL(action, "https://shop.test/page"), LOCATION, "guestbook");

describe("ownAction: the droplet's own action, exactly", () => {
  it("matches <location>/droplets/<id>, naming the action", () => {
    expect(at(OWN)).toEqual({ url: OWN, name: "default" });
    expect(at(`${OWN}?/leave&page=2#top`)).toEqual({ url: `${OWN}?/leave&page=2`, name: "leave" });
  });

  it("refuses another origin, with the same path", () => {
    expect(at("https://evil.test/mfe/droplets/guestbook")).toBeNull();
    expect(at("http://drops.test/mfe/droplets/guestbook")).toBeNull();
    expect(at("https://drops.test:8443/mfe/droplets/guestbook")).toBeNull();
  });

  it("refuses a look-alike path: a prefix, a longer id, another prefix", () => {
    for (const path of ["/mfe/droplets/guest", "/mfe/droplets/guestbook-evil", "/mfe/droplets/guestbook/_data", "/mfe-evil/droplets/guestbook", "/droplets/guestbook"]) {
      expect(at(`https://drops.test${path}`), path).toBeNull();
    }
  });

  it("refuses a javascript: or data: URL, and credentials", () => {
    expect(at("javascript:alert(1)//https://drops.test/mfe/droplets/guestbook")).toBeNull();
    expect(at("data:text/html,https://drops.test/mfe/droplets/guestbook")).toBeNull();
    expect(at("https://user:pw@drops.test/mfe/droplets/guestbook")).toBeNull();
  });
});

describe("submission", () => {
  it("takes the submitter's formaction, formmethod and formenctype over the form's", () => {
    document.body.innerHTML = `<form method="get" action="${OWN}"><button formaction="javascript:alert(1)" formmethod="POST" formenctype="multipart/form-data">x</button></form>`;
    const form = document.querySelector("form")!;
    const submit = submission(form, form.querySelector("button"), document.baseURI);
    expect(submit.action?.protocol).toBe("javascript:");
    expect(submit.method).toBe("post");
    expect(submit.enctype).toBe("multipart/form-data");
    expect(ownAction(submit.action, LOCATION, "guestbook")).toBeNull();
  });

  it("reads attributes, never a control that shadows form.action", () => {
    document.body.innerHTML = `<form method="post" action="${OWN}"><input name="action" value="x"><input name="method" value="get"></form>`;
    const submit = submission(document.querySelector("form")!, null, document.baseURI);
    expect(submit.action?.href).toBe(OWN);
    expect(submit.method).toBe("post");
  });
});

describe("actionAnswer and redirectTarget", () => {
  it("takes a result by its shape, own keys only, and nothing else", () => {
    expect(actionAnswer('{"type":"success","status":200,"data":{"a":1}}')).toEqual({ type: "success", status: 200, data: { a: 1 } });
    expect(actionAnswer('{"type":"redirect","status":303,"location":"/bye"}')).toEqual({ type: "redirect", status: 303, location: "/bye" });
    for (const body of ["", "nope", "[]", '{"message":"boom"}', '{"type":"error","status":500}', '{"type":"success","status":"200"}', '{"type":"redirect","status":303}', '{"__proto__":{"type":"success","status":200}}']) {
      expect(actionAnswer(body), body).toBeNull();
    }
  });

  it("lets a redirect go to http(s) only", () => {
    expect(redirectTarget("/bye", "https://shop.test/p")).toBe("https://shop.test/bye");
    expect(redirectTarget("javascript:alert(1)", "https://shop.test/p")).toBeNull();
    expect(redirectTarget("data:text/html,x", "https://shop.test/p")).toBeNull();
  });
});

describe("enhanceDropletForm", () => {
  let posted: { url: string; accept: string | null; body: unknown; redirect: string | undefined }[];
  let answer: () => Response;
  let events: DropletActionDetail[];
  const realFetch = globalThis.fetch;
  const listen = (event: Event) => void events.push((event as CustomEvent<DropletActionDetail>).detail);
  /** Submits that reached the document un-prevented: the browser's. Prevented here, so happy-dom does not navigate. */
  let native: string[];
  const onDocument = (event: Event) => {
    if (!event.defaultPrevented) native.push((event.target as HTMLFormElement).dataset["testid"] ?? "");
    event.preventDefault();
  };

  beforeEach(() => {
    posted = [];
    events = [];
    native = [];
    answer = () => Response.json({ type: "success", status: 200, data: { message: "Thanks, Ana" } });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      posted.push({
        url: String(input),
        accept: new Headers(init?.headers).get("accept"),
        body: init?.body,
        redirect: init?.redirect,
      });
      return answer();
    }) as typeof fetch;
    globalThis.addEventListener("droplets:action", listen);
    document.addEventListener("submit", onDocument);
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    globalThis.removeEventListener("droplets:action", listen);
    document.removeEventListener("submit", onDocument);
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  const mount = (forms: string): Host => {
    document.body.innerHTML = `<enhance-host data-droplet="guestbook">${forms}</enhance-host>`;
    return document.querySelector("enhance-host") as Host;
  };
  const form = (testid: string) => document.querySelector<HTMLFormElement>(`[data-testid=${testid}]`)!;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

  it("posts its own action as JSON and has the element render the result", async () => {
    const host = mount(`<form data-testid="sign" method="post" action="${OWN}?page=2"><input name="name" value="Ana"><button name="go" value="1">Go</button></form>`);
    enhanceDropletForm(form("sign"));
    form("sign").querySelector("button")!.click();
    await flush();
    expect(native).toEqual([]);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ url: `${OWN}?page=2`, accept: "application/json", redirect: "manual" });
    expect(String(posted[0]!.body)).toBe("name=Ana&go=1");
    expect(host.forms).toEqual([{ message: "Thanks, Ana" }]);
    expect(events).toEqual([{ droplet: "guestbook", action: "default", type: "success", status: 200, data: { message: "Thanks, Ana" } }]);
  });

  it("sends multipart as FormData, and follows a redirect to http(s) only", async () => {
    const assign = vi.spyOn(globalThis.location, "assign").mockImplementation(() => {});
    mount(`<form data-testid="leave" method="post" enctype="multipart/form-data" action="${OWN}?/leave"></form>`);
    enhanceDropletForm(form("leave"));
    answer = () => Response.json({ type: "redirect", status: 303, location: "https://shop.test/bye" });
    form("leave").requestSubmit();
    await flush();
    expect(posted[0]?.body).toBeInstanceOf(FormData);
    expect(assign).toHaveBeenCalledWith("https://shop.test/bye");
    expect(events[0]).toMatchObject({ action: "leave", type: "redirect", status: 303, data: undefined });

    answer = () => Response.json({ type: "redirect", status: 303, location: "javascript:alert(1)" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    form("leave").requestSubmit();
    await flush();
    expect(assign).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
  });

  it("ignores a second submit while one is in flight", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const host = mount(`<form data-testid="sign" method="post" action="${OWN}"></form>`);
    enhanceDropletForm(form("sign"));
    const respond = answer;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      posted.push({ url: String(input), accept: null, body: null, redirect: undefined });
      await held;
      return respond();
    }) as typeof fetch;
    form("sign").requestSubmit();
    form("sign").requestSubmit();
    expect(native).toEqual([]);
    release();
    await flush();
    expect(posted).toHaveLength(1);
    expect(host.forms).toHaveLength(1);
    // Once it settled, the next one goes.
    form("sign").requestSubmit();
    await flush();
    expect(posted).toHaveLength(2);
  });

  it("leaves to the browser what is not its own droplet's action POST", async () => {
    mount(
      `<form data-testid="get" action="${OWN}"></form>` +
        `<form data-testid="other" method="post" action="https://evil.test/mfe/droplets/guestbook"></form>` +
        `<form data-testid="prefix" method="post" action="${OWN}-evil"></form>` +
        `<form data-testid="script" method="post" action="${OWN}"><button formaction="javascript:void(0)">x</button></form>` +
        `<form data-testid="blank" method="post" target="_blank" action="${OWN}"></form>` +
        `<form data-testid="text" method="post" enctype="text/plain" action="${OWN}"></form>` +
        `<form data-testid="named" method="post" action="${OWN}?/echo"></form>` +
        `<form data-testid="untouched" method="post" action="${OWN}"></form>`,
    );
    for (const id of ["get", "other", "prefix", "script", "blank", "text"]) enhanceDropletForm(form(id));
    enhanceDropletForm(form("named"), { action: "default" });
    form("script").querySelector("button")!.click();
    for (const id of ["get", "other", "prefix", "blank", "text", "named", "untouched"]) form(id).requestSubmit();
    await flush();
    expect(posted).toEqual([]);
    expect(native).toEqual(["script", "get", "other", "prefix", "blank", "text", "named", "untouched"]);
  });

  it("finds its droplet element from a component's shadow root (Lit)", async () => {
    const host = mount(`<div data-app-entry><shadow-card></shadow-card></div>`);
    const root = host.querySelector("shadow-card")!.attachShadow({ mode: "open" });
    root.innerHTML = `<form data-testid="sign" method="post" action="${OWN}"><input name="name" value="Ana"></form>`;
    const inShadow = root.querySelector("form")!;
    enhanceDropletForm(inShadow);
    inShadow.requestSubmit();
    await flush();
    expect(posted).toHaveLength(1);
    expect(host.forms).toEqual([{ message: "Thanks, Ana" }]);
  });

  it("leaves a form outside any droplet element, or in the host's children, alone", async () => {
    document.body.innerHTML =
      `<form data-testid="loose" method="post" action="${OWN}"></form>` +
      `<enhance-host data-droplet="guestbook"><div data-app-slot><form data-testid="kid" method="post" action="${OWN}"></form></div></enhance-host>`;
    enhanceDropletForm(form("loose"));
    enhanceDropletForm(form("kid"));
    form("loose").requestSubmit();
    form("kid").requestSubmit();
    await flush();
    expect(posted).toEqual([]);
    expect(native).toEqual(["loose", "kid"]);
  });

  it("hands onSubmit the fields and a cancel, onResult the result and update()", async () => {
    const host = mount(`<form data-testid="sign" method="post" action="${OWN}"><input name="name" value="Ana"></form>`);
    let cancel = true;
    const results: unknown[] = [];
    const stop = enhanceDropletForm(form("sign"), {
      onSubmit: ({ formData, cancel: stopIt }) => {
        formData.set("name", "Bo");
        if (cancel) stopIt();
      },
      onResult: async ({ type, status, data, update }) => {
        results.push({ type, status, data });
        await update();
      },
    });
    form("sign").requestSubmit();
    await flush();
    expect(posted).toEqual([]);
    expect(native).toEqual([]);

    cancel = false;
    form("sign").requestSubmit();
    await flush();
    expect(String(posted[0]?.body)).toBe("name=Bo");
    expect(results).toEqual([{ type: "success", status: 200, data: { message: "Thanks, Ana" } }]);
    expect(host.forms).toHaveLength(1);

    // Stopped: the browser's again.
    stop();
    form("sign").requestSubmit();
    await flush();
    expect(native).toEqual(["sign"]);
  });

  it("applies nothing for an answer that is no result, and gives the page a copy of the data", async () => {
    const host = mount(`<form data-testid="sign" method="post" action="${OWN}"></form>`);
    enhanceDropletForm(form("sign"), { onResult: ({ data }) => void ((data as { message: string }).message = "changed") });
    form("sign").requestSubmit();
    await flush();
    expect(events[0]?.data).toEqual({ message: "Thanks, Ana" });

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    answer = () => Response.json({ message: "Internal Error" }, { status: 500 });
    enhanceDropletForm(form("sign"));
    form("sign").requestSubmit();
    await flush();
    expect(events).toHaveLength(1);
    expect(host.forms).toEqual([]);
    expect(error).toHaveBeenCalled();
  });
});
