const http = require("http");
const { spawn } = require("child_process");

const SERVER_URL = "http://localhost:5003/api/health";
const MAX_RETRIES = 60;
const RETRY_INTERVAL = 1000;

function checkServer() {
  return new Promise((resolve) => {
    http
      .get(SERVER_URL, (res) => {
        resolve(res.statusCode === 200);
      })
      .on("error", () => resolve(false));
  });
}

async function main() {
  console.log("[wait-for-server] Waiting for backend to be ready...");

  for (let i = 0; i < MAX_RETRIES; i++) {
    if (await checkServer()) {
      console.log("[wait-for-server] Backend is ready. Starting client...");
      const child = spawn("node", ["node_modules/vite/bin/vite.js", "--host"], {
        stdio: "inherit",
        cwd: __dirname + "/..",
      });
      child.on("exit", (code) => process.exit(code ?? 0));
      return;
    }
    await new Promise((r) => setTimeout(r, RETRY_INTERVAL));
  }

  console.error("[wait-for-server] Backend did not start in time. Starting client anyway...");
  const child = spawn("node", ["node_modules/vite/bin/vite.js", "--host"], {
    stdio: "inherit",
    cwd: __dirname + "/..",
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

main();
