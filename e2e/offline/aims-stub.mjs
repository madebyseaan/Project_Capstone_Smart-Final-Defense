/**
 * aims-stub.mjs — loopback AIMS fixture server for the offline rig.
 * Health + course list + scores (404 = unknown course, a valid AIMS behavior).
 */
import http from "node:http";

const PORT = Number(process.env.AIMS_STUB_PORT ?? 5997);
const STATE = { mode: "online", counters: {}, hung: new Set() };

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  STATE.counters[url.pathname] = (STATE.counters[url.pathname] ?? 0) + 1;

  if (url.pathname === "/_control/state" && req.method === "GET") {
    return send(res, 200, { mode: STATE.mode, counters: STATE.counters });
  }
  if (url.pathname === "/_control/mode" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        if (!["online", "hang", "refuse", "error500"].includes(parsed.mode)) {
          return send(res, 400, { error: "bad mode" });
        }
        STATE.mode = parsed.mode;
        if (STATE.mode !== "hang") {
          for (const s of STATE.hung) s.destroy();
          STATE.hung.clear();
        }
        return send(res, 200, { ok: true, mode: STATE.mode });
      } catch {
        return send(res, 400, { error: "bad JSON" });
      }
    });
    return undefined;
  }

  if (STATE.mode === "refuse") return req.socket.destroy();
  if (STATE.mode === "hang") {
    STATE.hung.add(req.socket);
    req.socket.on("close", () => STATE.hung.delete(req.socket));
    return undefined;
  }
  if (STATE.mode === "error500") return send(res, 500, { error: "simulated outage" });

  if (url.pathname === "/api/v1/health") return send(res, 200, { status: "ok" });
  if (url.pathname === "/api/v1/public/courses") return send(res, 200, { data: [] });
  if (url.pathname.startsWith("/api/v1/public/courses/")) return send(res, 404, { error: "course not found" });
  return send(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[aims-stub] listening on http://127.0.0.1:${PORT} (mode=${STATE.mode})`);
});
