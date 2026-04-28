# Cloudflare Deployment Notes

This project can use Cloudflare in two ways.

## Recommended: Pages Fixed Frontend With Built-In API Proxy

This is the easiest no-domain setup:

```text
Cloudflare Pages fixed frontend
  -> Pages Function /api/* proxy
  -> current quick Tunnel URL
  -> local backend on http://localhost:3011
```

The Pages Function lives at:

```text
frontend/functions/api/[[path]].ts
```

In Cloudflare Pages, set:

```text
Root directory: frontend
Build command: npm run build
Output directory: dist
Environment variable:
VITE_API_BASE_URL=/api
Secret:
BACKEND_BASE_URL=https://your-current-tunnel.trycloudflare.com
```

After the Pages project exists, local startup can also update the Pages secret:

```powershell
cd "C:\Users\ug1ra\Documents\New project"
.\scripts\start-local-with-tunnel.ps1 -UpdatePagesSecret -PagesProjectName youtube-finder
```

That keeps the public frontend fixed while pointing its `/api` proxy at the newest quick Tunnel URL.

## Alternative: Separate Worker API Proxy

This requires registering a workers.dev subdomain or adding a custom route.

This project can also use Cloudflare in two layers:

1. Cloudflare Pages hosts the fixed frontend URL.
2. Cloudflare Workers hosts a fixed API gateway that proxies to the current local Cloudflare Tunnel URL.

The local quick Tunnel URL still changes when restarted, but the frontend can keep calling the fixed Worker URL.

## API Proxy Worker

Worker directory:

```text
cloudflare/api-proxy
```

Deploy once:

```powershell
cd "C:\Users\ug1ra\Documents\New project\cloudflare\api-proxy"
npm install
npx wrangler login
npx wrangler deploy
```

Set the current backend Tunnel URL:

```powershell
"https://your-current-tunnel.trycloudflare.com" | npx wrangler secret put BACKEND_BASE_URL
```

After deploy, Wrangler will print a fixed URL similar to:

```text
https://youtube-finder-api.<your-worker-subdomain>.workers.dev
```

Use that fixed URL as the frontend `VITE_API_BASE_URL`.

## Cloudflare Pages Frontend

Create a Pages project from the repository with:

```text
Root directory: frontend
Build command: npm run build
Output directory: dist
```

Environment variable:

```text
VITE_API_BASE_URL=https://youtube-finder-api.<your-worker-subdomain>.workers.dev
```

## Local Automation

Run:

```powershell
cd "C:\Users\ug1ra\Documents\New project"
.\scripts\start-local-with-tunnel.ps1
```

This starts:

- backend
- Cloudflare quick Tunnel
- frontend

It also writes the new quick Tunnel URL into:

```text
frontend/.env.local
```

If the Worker has already been deployed and Wrangler is logged in, run:

```powershell
.\scripts\start-local-with-tunnel.ps1 -UpdateWorkerSecret
```

That updates the Worker `BACKEND_BASE_URL` secret to the newest quick Tunnel URL.
