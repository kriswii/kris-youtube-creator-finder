export interface Env {
  BACKEND_BASE_URL: string;
  ALLOWED_ORIGINS?: string;
}

function buildCorsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("Origin") ?? "*";
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "*")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const allowOrigin = allowedOrigins.includes("*") || allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? "*";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") ?? "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(buildCorsHeaders(request, env))) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function resolveBackendUrl(request: Request, backendBaseUrl: string): string {
  const incoming = new URL(request.url);
  const backend = new URL(backendBaseUrl);
  backend.pathname = incoming.pathname;
  backend.search = incoming.search;
  return backend.toString();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(request, env)
      });
    }

    if (!env.BACKEND_BASE_URL) {
      return withCors(
        Response.json({ ok: false, error: "BACKEND_BASE_URL is not configured" }, { status: 500 }),
        request,
        env
      );
    }

    const headers = new Headers(request.headers);
    headers.delete("Host");

    const proxiedRequest = new Request(resolveBackendUrl(request, env.BACKEND_BASE_URL), {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual"
    });

    try {
      const response = await fetch(proxiedRequest);
      return withCors(response, request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy request failed";
      return withCors(Response.json({ ok: false, error: message }, { status: 502 }), request, env);
    }
  }
};
