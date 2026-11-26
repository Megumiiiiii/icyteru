"""Minimal Hermes gateway stand-in used to smoke-test the Tauri desktop host.

Serves the HTTP endpoints the Icyteru client needs (status, password login,
session probe, WS ticket) plus a JSON-RPC WebSocket, so the desktop host can be
exercised end to end without a live gateway.
"""
import asyncio
import json
import sys

from aiohttp import web

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9231
COOKIE = ("hermes_session", "smoke-session")
TICKET = "smoke-ticket"
METHODS = {
    "gateway.ping": {},
    "sessions.list": {"sessions": []},
    "profiles.list": {"profiles": [], "active": ""},
    "skills.list": {"skills": [], "note": ""},
    "memory.get": {"memory": {}},
    "models.list": {"models": [], "current": None, "global": None},
}


async def status(_request):
    return web.json_response({
        "version": "0.0.0-smoke",
        "gateway_running": True,
        "auth_required": True,
        "auth_providers": ["basic"],
        "components": {"gateway": {"status": "ok"}},
        "overall": "ok",
    })


async def login(request):
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"detail": "bad body"}, status=400)
    if body.get("provider") == "basic" and body.get("username") == "demo" and body.get("password") == "smoke":
        response = web.json_response({"ok": True})
        response.set_cookie(COOKIE[0], COOKIE[1], httponly=True, path="/")
        return response
    return web.json_response({"detail": "Invalid credentials"}, status=401)


def signed_in(request) -> bool:
    return request.cookies.get(COOKIE[0]) == COOKIE[1]


async def me(request):
    return web.json_response({"ok": True}) if signed_in(request) else web.json_response({"detail": "no"}, status=401)


async def ticket(request):
    return web.json_response({"ticket": TICKET}) if signed_in(request) else web.json_response({"detail": "no"}, status=401)


FEED_STARTED = 0


async def feed_events(request):
    """One fresh event per poll so the native poller has something to forward."""
    global FEED_STARTED
    since = int(request.query.get("since", "0") or 0)
    visible = bool(request.headers.get("X-Hermes-Session-Token")) or bool(request.headers.get("Cookie"))
    print(f"feed poll since={since} authed={visible}", flush=True)
    if not signed_in(request):
        return web.json_response({"detail": "no"}, status=401)
    FEED_STARTED += 1
    events = []
    if FEED_STARTED % 3 == 0:
        events.append({
            "session_id": "smoke-other-session",
            "title": "Hermes",
            "body": f"smoke event {FEED_STARTED}",
            "at": since + 1,
        })
    return web.json_response({"events": events})


async def echo(request):
    return web.json_response({})


async def socket(request):
    protocols = [value.strip() for value in request.headers.get("Sec-WebSocket-Protocol", "").split(",") if value.strip()]
    ticket_ok = f"hermes-gateway-ticket.{TICKET}" in protocols
    token_ok = "token=demo-token" in request.query_string
    if not (ticket_ok or token_ok or signed_in(request)):
        raise web.HTTPForbidden(text="origin_mismatch")
    ws = web.WebSocketResponse(protocols=["hermes-gateway-v1"])
    await ws.prepare(request)
    await ws.send_json({
        "jsonrpc": "2.0",
        "method": "event",
        "params": {"type": "gateway.ready", "payload": {"version": "0.0.0-smoke"}},
    })
    async for message in ws:
        if message.type is not web.WSMsgType.TEXT:
            continue
        frame = json.loads(message.data)
        if "id" not in frame:
            continue
        await ws.send_json({"jsonrpc": "2.0", "id": frame["id"], "result": METHODS.get(frame.get("method", ""), {})})
    return ws


def app() -> web.Application:
    server = web.Application()
    server.router.add_get("/api/status", status)
    server.router.add_post("/auth/password-login", login)
    server.router.add_get("/api/auth/me", me)
    server.router.add_post("/api/auth/ws-ticket", ticket)
    server.router.add_post("/api/webapp/socket-ticket", ticket)
    server.router.add_get("/api/plugins/icyteru-push/events", feed_events)
    server.router.add_get("/api/ws", socket)
    server.router.add_route("*", "/{tail:.*}", echo)
    return server


if __name__ == "__main__":
    print(f"mock gateway listening on {PORT}", flush=True)
    asyncio.run(web._run_app(app(), host="127.0.0.1", port=PORT, print=None))
