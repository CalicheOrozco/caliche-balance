// Starts the local API (port 3001) and the Vite dev server (port 5173) together,
// and stops both when either exits or on Ctrl+C.
import { spawn } from "node:child_process";

const children = [
  spawn("npx", ["tsx", "watch", "server/dev.ts"], { stdio: "inherit" }),
  spawn("npx", ["vite", "--port", "5173", "--strictPort"], { stdio: "inherit" }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 3000).unref();
}

for (const child of children) child.on("exit", (code) => stop(code ?? 0));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
