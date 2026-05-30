import { createReadStream, existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(".");
const port = Number(process.env.PORT || 8081);
const host = process.env.HOST || "127.0.0.1";

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

async function handleApiRequest(pathname, response) {
  try {
    if (pathname === "/api/queue") {
      const queuePath = join(root, "queue.json");
      const data = await readFile(queuePath, "utf-8");
      const queue = JSON.parse(data || "[]");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(queue));
      return true;
    }
  } catch (error) {
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: error.message }));
    return true;
  }
  return false;
}

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${host}:${port}`);
  const pathname = normalize(decodeURIComponent(url.pathname));

  // Handle API endpoints
  if (pathname.startsWith("/api/")) {
    const handled = await handleApiRequest(pathname, response);
    if (handled) return;
  }

  const cleanPath = pathname.replace(/^(\.\.[/\\])+/, "");
  let filePath = resolve(join(root, cleanPath));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  if (!existsSync(filePath) || (await stat(filePath)).isDirectory()) {
    filePath = join(root, "index.html");
  }

  response.writeHead(200, {
    "Content-Type": types[extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(filePath).pipe(response);
}).listen(port, host, () => {
  console.log(`RedditAuth running at http://${host}:${port}/`);
});
