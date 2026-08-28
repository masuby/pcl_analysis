// Dev server that talks to the PRODUCTION API.
//
// Used to drive a production report from a local browser. The browser only ever
// talks to localhost; this proxy forwards /api to the live server. That matters
// because production serves a self-signed certificate, which a browser refuses
// outright — Node can be told to accept it, a browser cannot without the user
// clicking through a warning on every request.
//
// Read-only work is the intent; anything that writes is still a real write to
// production, so use it deliberately.
//
//   npx vite --config vite.config.prod-proxy.mjs --port 5199
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const TARGET = process.env.PROD_API_URL || "https://154.72.68.246:8443";

export default defineConfig({
  plugins: [react()],
  // Empty string means "same origin", so the app calls /api on localhost and
  // the proxy below carries it to production.
  define: { "import.meta.env.VITE_API_URL": JSON.stringify("") },
  server: {
    port: 5199,
    proxy: {
      "/api": {
        target: TARGET,
        changeOrigin: true,
        secure: false,          // production's certificate is self-signed
        configure(proxy) {
          // Production's CORS list does not include this dev origin, and its
          // middleware rejects an unknown Origin with a 403 before the request
          // ever reaches authentication — which shows up as an upload failing
          // while GETs succeed. Presenting the request as same-origin avoids
          // having to widen the server's CORS list just to run a report.
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("origin", TARGET);
            proxyReq.setHeader("referer", TARGET + "/");
          });
        },
      },
    },
  },
});
