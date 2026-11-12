// test/dev.test.ts picks free ports: its dev server's and its host page's,
// on another origin.
const port = Number(process.env["DEV_MIXED_PORT"]);
const host = process.env["DEV_MIXED_HOST"];

export default {
  element: "djs-mixed",
  cors: true,
  ...(host ? { trustedOrigins: [host] } : {}),
  ...(port ? { dev: { server: { port } } } : {}),
};
