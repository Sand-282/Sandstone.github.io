import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const configuredBackend = process.env.PAGES_BACKEND_URL?.trim() || "";
let backendOrigin = "";
if (configuredBackend) {
  const backend = new URL(configuredBackend);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname);
  if ((backend.protocol !== "https:" && !(local && backend.protocol === "http:")) || backend.username || backend.password || backend.pathname !== "/" || backend.search || backend.hash) {
    throw new Error("PAGES_BACKEND_URL must be the HTTPS origin of the commission backend, without a path, query, credentials or fragment. Local HTTP is supported for previews.");
  }
  backendOrigin = backend.origin;
}

export default defineConfig({
  root: fromRoot("./frontend"),
  base: "/Sandstone.github.io/",
  publicDir: fromRoot("./public"),
  plugins: [react()],
  define: {
    "process.env.NEXT_PUBLIC_PAGES_MODE": JSON.stringify("true"),
    "process.env.NEXT_PUBLIC_BACKEND_URL": JSON.stringify(backendOrigin),
  },
  build: {
    outDir: fromRoot("./pages-dist"),
    emptyOutDir: true,
    sourcemap: false,
  },
});

