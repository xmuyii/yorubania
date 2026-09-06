// Deliberately plain Node (no bundler needed for this tiny script) so it
// runs the same way whether started locally or by Railway.
const http = require("http");
const handler = require("serve-handler");

const port = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  return handler(req, res, { public: "dist" });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Yorubania frontend serving on port ${port}`);
});
