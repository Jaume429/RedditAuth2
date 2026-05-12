from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import socket
import subprocess
import sys
import urllib.request
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
HOST = "0.0.0.0"
PORT = 8000
QUEUE_FILE = ROOT / "queue.json"

GUMROAD_TOKEN = "3oLvgbdcBVg-ka0klN-3LEe9f1TeNzFc5IOOlSCfYcA"
GUMROAD_PRODUCT_ID = "dicmd"

PROXY_HOST = "p.webshare.io"
PROXY_PORT = 10000
PROXY_USER = "aaubcdkx"
PROXY_PASS = "ecljgj60smyr"


class NoCacheHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/reddit"):
            self.proxy_reddit()
            return
        if self.path == "/api/queue":
            self.return_queue()
            return
        if self.path == "/api/gumroad":
            self.return_gumroad()
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/queue/clear":
            self.clear_pending_queue()
            return
        if self.path == "/api/queue/run":
            self.run_queue_job()
            return
        if self.path == "/api/queue/add":
            self.add_to_queue_item()
            return
        self.send_error(404, "Unknown API endpoint")

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):
        return

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_queue_items(self):
        if not QUEUE_FILE.exists():
            return []
        try:
            data = json.loads(QUEUE_FILE.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
        except json.JSONDecodeError:
            return []

    def write_queue_items(self, items):
        QUEUE_FILE.write_text(json.dumps(items, indent=2), encoding="utf-8")

    def return_queue(self):
        self.send_json(self.read_queue_items())

    def clear_pending_queue(self):
        items = self.read_queue_items()
        kept = [item for item in items if item.get("status") != "pending"]
        self.write_queue_items(kept)
        self.send_json({"ok": True, "cleared": len(items) - len(kept), "items": kept})

    def run_queue_job(self):
        process = getattr(self.server, "queue_process", None)
        if process and process.poll() is None:
            self.send_json({"ok": False, "error": "Queue job already running"}, status=409)
            return
        process = subprocess.Popen(
            ["node", "reddit-queue.mjs", "run"],
            cwd=str(ROOT),
            stdout=sys.stdout,
            stderr=sys.stderr,
        )
        self.server.queue_process = process
        self.send_json({"ok": True, "pid": process.pid}, status=202)

    def add_to_queue_item(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            payload = json.loads(body.decode("utf-8"))
            
            postUrl = payload.get("postUrl", "").strip()
            commentText = payload.get("commentText", "").strip()
            subreddit = payload.get("subreddit", "").strip()
            
            if not postUrl or not commentText or not subreddit:
                self.send_json(
                    {"ok": False, "error": "Missing postUrl, commentText, or subreddit"},
                    status=400
                )
                return
            
            # Build a queue item similar to reddit-queue.mjs
            import time
            item = {
                "id": f"queue_{int(time.time() * 1000)}_{int(time.time() % 1 * 1000000)}",
                "postUrl": postUrl,
                "commentText": commentText,
                "subreddit": subreddit,
                "status": "pending",
                "scheduledAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "postedAt": None,
            }
            
            items = self.read_queue_items()
            items.append(item)
            self.write_queue_items(items)
            
            self.send_json({"ok": True, "item": item}, status=201)
        except json.JSONDecodeError:
            self.send_json({"ok": False, "error": "Invalid JSON"}, status=400)
        except Exception as e:
            self.send_json({"ok": False, "error": str(e)}, status=500)

    def return_gumroad(self):
        try:
            url = f"https://api.gumroad.com/v2/products/{GUMROAD_PRODUCT_ID}/sales?access_token={GUMROAD_TOKEN}"
            request = Request(url, headers={"Accept": "application/json"})
            with urlopen(request, timeout=10) as response:
                data = json.loads(response.read())
            sales = data.get("sales", [])
            total_sales = len(sales)
            total_revenue = sum(float(s.get("price", 0)) for s in sales) / 100
            self.send_json({
                "total_sales": total_sales,
                "total_revenue": round(total_revenue, 2)
            })
        except Exception as e:
            self.send_json({"error": str(e)}, status=500)

    def proxy_reddit(self):
        params = parse_qs(urlparse(self.path).query)
        subreddit = params.get("subreddit", [""])[0].strip()
        query = params.get("query", [""])[0].strip()

        if not subreddit or not query:
            self.send_error(400, "Missing subreddit or query")
            return

        reddit_url = (
            f"https://www.reddit.com/r/{quote(subreddit)}/search.json"
            f"?q={quote(query)}&sort=new&limit=25&t=day&restrict_sr=1"
        )
        request = Request(
            reddit_url,
            headers={
                "User-Agent": "RedditScanner/1.0",
                "Accept": "application/json",
            },
        )

        try:
            proxy_handler = urllib.request.ProxyHandler({
                'http': f'http://{PROXY_USER}:{PROXY_PASS}@{PROXY_HOST}:{PROXY_PORT}',
                'https': f'http://{PROXY_USER}:{PROXY_PASS}@{PROXY_HOST}:{PROXY_PORT}'
            })
            opener = urllib.request.build_opener(proxy_handler)
            response = opener.open(request, timeout=12)
            body = response.read()
            self.send_response(response.status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            response.close()
        except HTTPError as error:
            if error.code == 403:
                # Return empty results array for 403 Forbidden instead of propagating error
                print(f"[reddit-proxy] 403 blocked for r/{subreddit}", flush=True)
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(b'{"data": {"children": [], "after": null}}')
            else:
                self.send_response(error.code)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(error.read() or b'{"error":"Reddit request failed"}')
        except URLError as error:
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            message = str(error.reason).replace('"', "'")
            self.wfile.write(f'{{"error":"Reddit network failed: {message}"}}'.encode())
        except socket.timeout:
            self.send_response(504)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(b'{"error":"Reddit request timed out"}')


handler = partial(NoCacheHandler, directory=str(ROOT))
try:
    server = ThreadingHTTPServer((HOST, PORT), handler)
except OSError as error:
    print(f"Failed to start RedditAuth server on http://{HOST}:{PORT}/: {error}", flush=True)
    raise SystemExit(1)

print(f"RedditAuth server ready at http://{HOST}:{PORT}/", flush=True)
server.serve_forever()