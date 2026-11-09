export default {
  element: "djs-mixed",
  // The test's host page is on another port.
  cors: true,
  trustedOrigins: ["http://localhost:5192"],
  dev: { server: { port: 5191 } },
};
