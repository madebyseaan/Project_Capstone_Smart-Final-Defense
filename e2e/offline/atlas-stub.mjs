/**
 * atlas-stub.mjs — loopback ATLAS fixture server for the offline rig.
 * Minimal: health + runtime context + effective teaching load + faculty.
 * Control API mirrors the EP stub (mode switching).
 */
import http from "node:http";

const PORT = Number(process.env.ATLAS_STUB_PORT ?? 5998);
const STATE = { mode: "online", counters: {}, hung: new Set() };

function bump(p) {
  STATE.counters[p] = (STATE.counters[p] ?? 0) + 1;
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

function effectiveLoad() {
  return {
    source: {
      schoolId: Number(process.env.ATLAS_SCHOOL_ID ?? 1),
      schoolYearId: Number(process.env.ATLAS_SCHOOL_YEAR_ID ?? 10),
      state: "POPULATED",
      version: 1,
      initializedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActiveSchoolYear: true,
    },
    assignments: [],
    coverageTotals: {
      assignedPairs: 0,
      activeAssignedPairs: 0,
      realFacultyAssignedPairs: 0,
      syntheticPlaceholderPairs: 0,
      rawAssignedPairs: 0,
      totalPairs: 0,
      unassignedPairs: 0,
      rawUnassignedPairs: 0,
    },
  };
}

function routes(pathname) {
  if (pathname === "/api/v1/health") return { status: 200, body: { status: "ok" } };
  if (pathname === "/api/v1/runtime/context") {
    return {
      status: 200,
      body: {
        activeSchoolYearId: Number(process.env.ATLAS_SCHOOL_YEAR_ID ?? 10),
        source: "stub",
        upstreamVerified: true,
        activeTerm: null,
      },
    };
  }
  if (pathname === "/api/v1/faculty-assignments/effective") return { status: 200, body: effectiveLoad() };
  if (pathname === "/api/v1/faculty") return { status: 200, body: { faculty: [] } };
  return null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  bump(url.pathname);

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

  const route = routes(url.pathname);
  if (!route) return send(res, 404, { error: "not found" });
  return send(res, route.status, route.body);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[atlas-stub] listening on http://127.0.0.1:${PORT} (mode=${STATE.mode})`);
});
