import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Vercel serves static files; Vite's development/preview proxy is not deployed.
  if (command === "build" && env.VERCEL === "1") {
    let valid = false;
    try {
      const url = new URL(env.VITE_API_BASE_URL?.trim());
      valid =
        url.protocol === "https:" &&
        url.pathname.replace(/\/+$/, "") === "/api/v1" &&
        !url.search &&
        !url.hash &&
        !url.username &&
        !url.password;
    } catch {
      // Report a useful build error instead of publishing a broken API client.
    }
    if (!valid)
      throw new Error(
        "Set VITE_API_BASE_URL=https://YOUR-PUBLIC-BACKEND/api/v1 in Vercel and redeploy. API_PROXY_TARGET only works with Vite dev/preview.",
      );
  }
  const proxy = {
    "/api": {
      target: env.API_PROXY_TARGET || "http://localhost:8000",
      changeOrigin: true,
    },
  };
  return { plugins: [react()], server: { proxy }, preview: { proxy } };
});
