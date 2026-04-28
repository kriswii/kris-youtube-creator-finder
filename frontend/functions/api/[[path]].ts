interface Env {
  BACKEND_BASE_URL: string;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request)
    });
  }

  if (!env.BACKEND_BASE_URL) {
    return json({ ok: false, error: "BACKEND_BASE_URL is not configured" }, 500, request);
  }

  const target = new URL(request.url);
  const backend = new URL(env.BACKEND_BASE_URL);
  backend.pathname = target.pathname === "/api/health" ? "/health" : target.pathname;
  backend.search = target.search;

  const headers = new Headers(request.headers);
  headers.delete("Host");

  try {
    const response = await fetch(
      new Request(backend.toString(), {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual"
      })
    );

    return withCors(response, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Proxy request failed";
    return json({ ok: false, error: message }, 502, request);
  }
};

function corsHeaders(request: Request): HeadersInit {
  return {
    "Access-Control-Allow-Origin": request.headers.get("Origin") ?? "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") ?? "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

function withCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request))) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function json(body: unknown, status: number, request: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request)
    }
  });
}
