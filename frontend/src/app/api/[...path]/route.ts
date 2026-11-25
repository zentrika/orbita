/**
 * Proxy en tiempo de ejecución hacia el backend. Mantiene todo bajo el mismo origen, de modo
 * que la cookie de refresco (httpOnly, SameSite=Strict) nunca cruza dominios.
 */
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BACKEND = process.env.BACKEND_INTERNAL_URL || "http://localhost:8000";
const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "host", "content-length"]);

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = `${BACKEND}/api/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const headers = new Headers();
  req.headers.forEach((v, k) => {
    if (!HOP.has(k)) headers.set(k, v);
  });
  const fwd = req.headers.get("x-forwarded-for");
  headers.set("x-forwarded-for", fwd || "127.0.0.1");
  headers.set("x-forwarded-proto", req.nextUrl.protocol.replace(":", ""));

  const hasBody = !["GET", "HEAD"].includes(req.method);
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: "manual",
      cache: "no-store",
      // @ts-expect-error — requerido por Node para cuerpos en streaming
      duplex: hasBody ? "half" : undefined,
    });
  } catch {
    return Response.json({ detail: "El servidor no está disponible" }, { status: 502 });
  }
  const out = new Headers();
  upstream.headers.forEach((v, k) => {
    if (!HOP.has(k) && k !== "content-encoding" && k !== "set-cookie") out.set(k, v);
  });
  for (const c of upstream.headers.getSetCookie()) out.append("set-cookie", c);
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT, proxy as DELETE };
