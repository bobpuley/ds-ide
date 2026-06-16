---
name: vite-proxy-endpoints
description: Checklist for Vite proxy configuration when adding backend endpoints. Use when adding new POST/GET endpoints to a backend server, or when debugging 404 errors in development.
---

# Vite Proxy Endpoints

When developing a Vite frontend with a backend server (Node.js, Hono, Express, etc.), the dev server needs to know how to proxy requests to the backend.

## Quick Check

Every time you add a new backend endpoint:

1. **Add it to `vite.config.ts`** in the `proxy` object:
   ```typescript
   proxy: {
     "/your-new-endpoint": "http://localhost:3000",
   }
   ```

2. **Restart the dev server** (`npm run dev`)

3. **Verify with browser DevTools** (F12 → Network tab):
   - Request should go to `localhost:3000` (via proxy)
   - Not `localhost:5173` (Vite port)

## Common Endpoints to Proxy

Typical pattern in modern Vite + backend setups:

```typescript
// client/vite.config.ts
proxy: {
  "/api": "http://localhost:3000",      // All API routes
  "/user-input": "http://localhost:3000", // Form submissions
  "/graph-interaction": "http://localhost:3000", // Real-time interactions
  "/health": "http://localhost:3000",    // Health checks
  "/stream": {                           // WebSocket
    target: "ws://localhost:3000",
    ws: true,
    configure: (proxy) => {
      proxy.on("error", () => { /* handle */ });
    },
  },
}
```

## Debugging 404 Errors

If you get `POST /your-endpoint 404`:

1. Is the endpoint in `vite.config.ts` proxy config? → Add it
2. Did you restart the dev server? → Restart
3. Is the backend server running? → Start it
4. Check Network tab: is request going to `localhost:5173` or `localhost:3000`?

## Pattern to Remember

**Frontend request** → **Vite dev server (5173)** → **Backend proxy** → **Backend server (3000)**

If step 2 is missing the endpoint, requests fail at Vite, not the backend.
