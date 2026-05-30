from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import socket
import subprocess
import sys
import threading
import time
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

PROXY_URLS = [
    ("38.154.203.95", 5863),
    ("198.105.121.200", 6462),
    ("64.137.96.74", 6641),
    ("209.127.138.10", 5784),
    ("38.154.185.97", 6370),
    ("84.247.60.125", 6095),
    ("142.111.67.146", 5611),
    ("191.96.254.138", 6185),
    ("31.58.9.4", 6077),
    ("64.137.10.153", 5803),
]
PROXY_USER = "aaubcdkx"
PROXY_PASS = "ecljgj60smyr"
_proxy_index = 0


def normalize_post_url(post_url):
    value = str(post_url or "").strip().rstrip("/")
    parsed = urlparse(value)
    parts = [part for part in parsed.path.split("/") if part]
    lowered_parts = [part.lower() for part in parts]

    if "comments" in lowered_parts:
        comments_index = lowered_parts.index("comments")
        post_id = parts[comments_index + 1].lower() if comments_index + 1 < len(parts) else ""
        if post_id and post_id.isalnum():
            if "r" in lowered_parts:
                subreddit_index = lowered_parts.index("r")
                if subreddit_index + 1 < len(parts):
                    subreddit = parts[subreddit_index + 1].lower()
                    return f"https://reddit.com/r/{subreddit}/comments/{post_id}"
            return f"https://reddit.com/comments/{post_id}"

    return value


def start_queue_scheduler():
    process = subprocess.Popen(
        ["node", "reddit-queue.mjs", "schedule"],
        cwd=str(ROOT),
        stdout=sys.stdout,
        stderr=sys.stderr,
    )
    print(f"Started Reddit queue scheduler with pid {process.pid}", flush=True)
    return process


def monitor_queue_scheduler(server):
    while True:
        time.sleep(30)
        process = getattr(server, "queue_scheduler", None)
        if process and process.poll() is None:
            continue

        exit_code = process.poll() if process else "missing"
        print(f"Reddit queue scheduler stopped ({exit_code}). Restarting...", flush=True)
        server.queue_scheduler = start_queue_scheduler()


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
            normalized_post_url = normalize_post_url(postUrl)
            if any(normalize_post_url(existing.get("postUrl")) == normalized_post_url for existing in items):
                self.send_json(
                    {"ok": False, "error": "Post is already in the queue", "duplicate": True},
                    status=409
                )
                return

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
        global _proxy_index
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
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json",
                "Accept-Language": "en-US,en;q=0.5",
            },
        )

        # Try proxies in rotation, skip on failure
        last_error = None
        for _ in range(len(PROXY_URLS)):
            host, port = PROXY_URLS[_proxy_index % len(PROXY_URLS)]
            proxy_url = f"http://{PROXY_USER}:{PROXY_PASS}@{host}:{port}"
            try:
                proxy_handler = urllib.request.ProxyHandler({
                    'http': proxy_url,
                    'https': proxy_url,
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
                return
            except HTTPError as error:
                if error.code == 403:
                    print(f"[reddit-proxy] 403 blocked for r/{subreddit} via {host}", flush=True)
                    _proxy_index += 1
                    last_error = error
                    continue
                elif error.code in (402, 407):
                    print(f"[reddit-proxy] Proxy auth/credit issue {error.code} via {host}", flush=True)
                    _proxy_index += 1
                    last_error = error
                    continue
                else:
                    self.send_response(error.code)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(error.read() or b'{"error":"Reddit request failed"}')
                    return
            except (URLError, socket.timeout) as error:
                print(f"[reddit-proxy] Network error via {host}: {error}", flush=True)
                _proxy_index += 1
                last_error = error
                continue

        # All proxies failed
        print(f"[reddit-proxy] All proxies failed for r/{subreddit}", flush=True)
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(b'{"data": {"children": [], "after": null}}')


handler = partial(NoCacheHandler, directory=str(ROOT))
try:
    server = ThreadingHTTPServer((HOST, PORT), handler)
except OSError as error:
    print(f"Failed to start RedditAuth server on http://{HOST}:{PORT}/: {error}", flush=True)
    raise SystemExit(1)

print(f"RedditAuth server ready at http://{HOST}:{PORT}/", flush=True)
server.queue_scheduler = start_queue_scheduler()
threading.Thread(target=monitor_queue_scheduler, args=(server,), daemon=True).start()
server.serve_forever()
