const http = require("http");
const handler = require("serve-handler");
const port = 3001;
const server = http.createServer((req, res) => handler(req, res, { public: "dist" }));
server.listen(port, "0.0.0.0", () => console.log("old server on " + port));
