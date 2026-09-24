/**
 * enrollpro-stub.mjs — loopback EnrollPro fixture server for the offline rig.
 *
 * Modes (control API):
 *   online   — serve fixtures (default)
 *   hang     — accept connections, never respond (simulates a hung server)
 *   refuse   — close the connection immediately (ECONNREFUSED-like)
 *   error500 — respond 500 to every request
 *
 * Control:
 *   POST /_control/mode  { mode }
 *   POST /_control/year  { id, label, activeTerm }
 *   GET  /_control/state
 *   POST /_control/reset
 *
 * Fixtures are synthetic (year 2088-2089). No real data. No writes.
 */
import http from "node:http";

const PORT = Number(process.env.STUB_PORT ?? 5999);

const YEAR_A = { id: 900003, label: "2088-2089" };
const YEAR_B = { id: 900004, label: "2090-2091" };

const state = {
  mode: "online",
  year: { ...YEAR_A },
  activeTerm: "T1",
  counters: {},
  sockets: new Set(),
  hungSockets: new Set(),
};

function bump(path) {
  state.counters[path] = (state.counters[path] ?? 0) + 1;
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

const teacher = {
  id: 700001,
  employeeId: process.env.SMART_TEST_TEACHER_EMAIL ?? "1000001",
  firstName: "Rig",
  lastName: "Teacher",
  middleName: "T",
  email: "rig.teacher@example.test",
  isActive: true,
  subjects: [],
};

function routes(pathname) {
  switch (pathname) {
    case "/api/auth/login":
      return { status: 200, body: { token: "rig-token", user: { ...teacher, roles: ["TEACHER"] } } };
    case "/api/teachers":
      return { status: 200, body: { teachers: [teacher] } };
    case "/api/integration/v1/health":
      return { status: 200, body: { status: "ok" } };
    case "/api/integration/v1/school-year":
      return { status: 200, body: { data: { id: state.year.id, yearLabel: state.year.label } } };
    case "/api/integration/v1/active-term":
      return { status: 200, body: { data: { activeTerm: state.activeTerm, schoolYearId: state.year.id } } };
    case "/api/integration/v1/faculty":
      return { status: 200, body: { data: [], meta: { total: 0, page: 1, limit: 200, totalPages: 1 } } };
    case "/api/integration/v1/sections":
      return { status: 200, body: { data: [], meta: { total: 0, page: 1, limit: 200, totalPages: 1 } } };
    case "/api/integration/v1/learners":
      return { status: 200, body: { data: [], meta: { total: 0, page: 1, limit: 200, totalPages: 1 } } };
    case "/api/integration/v1/default/smart/students":
      return { status: 200, body: { data: [], meta: { total: 0, page: 1, limit: 200, totalPages: 1 } } };
    case "/api/integration/v1/default/smart/transferees":
      return {
        status: 200,
        body: {
          data: [],
          meta: {
            total: 0,
            page: 1,
            limit: 200,
            totalPages: 1,
            scopeSchoolYearId: state.year.id,
            scopeSchoolYearLabel: state.year.label,
            generatedAt: new Date().toISOString(),
          },
        },
      };
    case "/api/settings/public":
      return {
        status: 200,
        body: {
          schoolName: "Rig National High School",
          logoUrl: null,
          colorScheme: null,
          selectedAccentHsl: null,
          activeSchoolYearId: state.year.id,
          activeSchoolYearLabel: state.year.label,
          activeSchoolYearStatus: "ACTIVE",
          depedEmail: null,
        },
      };
    case "/api/school-years":
      return { status: 200, body: { schoolYears: [{ id: state.year.id, yearLabel: state.year.label, status: "ACTIVE" }] } };
    default:
      if (/^\/api\/integration\/v1\/sections\/\d+\/learners$/.test(pathname)) {
        const roster = [
          { learner: { id: 800001, lrn: "900000000001", firstName: "Rig", middleName: "A", lastName: "LearnerOne", sex: "MALE" }, enrollmentRecordId: 1 },
          { learner: { id: 800002, lrn: "900000000002", firstName: "Rig", middleName: "B", lastName: "LearnerTwo", sex: "FEMALE" }, enrollmentRecordId: 2 },
        ];
        return {
          status: 200,
          body: {
            data: roster,
            learners: roster,
            meta: { total: roster.length, page: 1, limit: 50, totalPages: 1 },
            total: roster.length,
          },
        };
      }
      if (/^\/api\/school-years\/\d+$/.test(pathname)) {
        return {
          status: 200,
          body: {
            year: {
              id: state.year.id,
              yearLabel: state.year.label,
              activeTerm: state.activeTerm,
              term1Start: "2088-06-01",
              term1End: "2088-09-30",
              term2Start: "2088-10-01",
              term2End: "2089-01-31",
              term3Start: "2089-02-01",
              term3End: "2089-05-31",
            },
          },
        };
      }
      return null;
  }
}

function handleControl(req, res, url) {
  if (req.method === "GET" && url.pathname === "/_control/state") {
    return send(res, 200, { mode: state.mode, year: state.year, activeTerm: state.activeTerm, counters: state.counters });
  }
  if (req.method === "POST" && url.pathname === "/_control/reset") {
    state.mode = "online";
    state.year = { ...YEAR_A };
    state.activeTerm = "T1";
    state.counters = {};
    for (const s of state.hungSockets) s.destroy();
    state.hungSockets.clear();
    return send(res, 200, { ok: true });
  }
  if (req.method === "POST" && (url.pathname === "/_control/mode" || url.pathname === "/_control/year")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        if (url.pathname === "/_control/mode") {
          if (!["online", "hang", "refuse", "error500"].includes(parsed.mode)) {
            return send(res, 400, { error: "mode must be online|hang|refuse|error500" });
          }
          state.mode = parsed.mode;
          if (parsed.mode !== "hang") {
            for (const s of state.hungSockets) s.destroy();
            state.hungSockets.clear();
          }
        } else {
          if (!parsed.id || !parsed.label) return send(res, 400, { error: "year requires id and label" });
          state.year = { id: Number(parsed.id), label: String(parsed.label) };
          if (parsed.activeTerm) state.activeTerm = String(parsed.activeTerm);
        }
        return send(res, 200, { ok: true, mode: state.mode, year: state.year, activeTerm: state.activeTerm });
      } catch {
        return send(res, 400, { error: "invalid JSON body" });
      }
    });
    return undefined;
  }
  return send(res, 404, { error: "unknown control route" });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  bump(url.pathname);

  if (url.pathname.startsWith("/_control/")) return handleControl(req, res, url);

  if (state.mode === "refuse") {
    req.socket.destroy();
    return;
  }
  if (state.mode === "hang") {
    // Keep the socket open; never respond. Track it so a mode switch can release it.
    state.hungSockets.add(req.socket);
    req.socket.on("close", () => state.hungSockets.delete(req.socket));
    return;
  }
  if (state.mode === "error500") {
    return send(res, 500, { error: "simulated outage" });
  }

  const route = routes(url.pathname);
  if (!route) return send(res, 404, { error: "not found" });
  return send(res, route.status, route.body);
});

server.on("connection", (socket) => {
  state.sockets.add(socket);
  socket.on("close", () => state.sockets.delete(socket));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[enrollpro-stub] listening on http://127.0.0.1:${PORT} (mode=${state.mode}, year=${state.year.label})`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    for (const s of state.sockets) s.destroy();
    server.close(() => process.exit(0));
  });
}
