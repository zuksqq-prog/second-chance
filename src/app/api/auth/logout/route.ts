import { json, route, SESSION_COOKIE } from "@/lib/server/http";

export const runtime = "nodejs";

export const POST = route(async () => {
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", expires: new Date(0) });
  return res;
});
