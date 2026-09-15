// Deliberately plain Node (no bundler needed for this tiny script) so it
// runs the same way whether started locally or by Railway.
const http = require("http");
const handler = require("serve-handler");

const port = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  // cleanUrls (serve-handler's default: true) redirects "/claim.html" to
  // "/claim" — and that redirect drops the query string, which silently
  // strips ?token=... from every invite link on the very first click.
  // Every link in this app explicitly uses .html extensions, so this
  // rewriting is never wanted here.
  return handler(req, res, { public: "dist", cleanUrls: false });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Yorubania frontend serving on port ${port}`);
});
