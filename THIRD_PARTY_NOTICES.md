# Third-party notices

## Hermes Agent

Copyright (c) 2025 Nous Research

Icyteru speaks the Hermes gateway protocol used by Hermes Desktop and the
dashboard (`GET /api/status`, WebSocket `/api/ws`, JSON-RPC methods such as
`prompt.submit`, and `message.delta` events).

`shared/protocol.ts` adapts the WebSocket URL construction from
`apps/shared/src/websocket-url.ts` and the desktop helper `buildGatewayWsUrl`
(`ws://` or `wss://` plus `/api/ws?token=` or `?ticket=`).

The JSON-RPC framing in `electron/socket.ts` follows
`apps/shared/src/json-rpc-channel.ts`: one JSON-RPC 2.0 object per text frame,
events as `{ "method": "event" }` notifications, and approval or clarify
questions as server requests answered with the same id. That file is a smaller
client written for Icyteru, not a copy of the Desktop client's reconnect code.

Hermes Agent is MIT licensed:

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Source: https://github.com/NousResearch/hermes-agent

## Inter

The interface uses the Inter typeface via `@fontsource/inter`.
Inter is licensed under the SIL Open Font License 1.1.
https://github.com/rsms/inter

## Akeru Bot

The layout is inspired by Akeru Bot (https://github.com/opencoredev/akeru-bot),
which is MIT licensed. Icyteru does not copy Akeru source code or assets.

## Sakuga VFX

Copyright (c) 2026 Justin Finkelman

`src/sakuga-core.js` is adapted from Sakuga VFX (`core.js`), which provides the
optional canvas-based anime/manga UI visual effects layer. Sakuga VFX is MIT
licensed.

Source: https://github.com/finktheartist/sakuga-vfx
