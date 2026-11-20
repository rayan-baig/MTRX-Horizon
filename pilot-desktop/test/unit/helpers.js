// Small helpers for the tests: a fake provider that answers with
// server-sent events, and a recorder for what was sent.
"use strict";

function sseBody(events) {
  return events.map((e) => (typeof e === "string" ? `data: ${e}\n\n` : `event: ${e.type || "message"}\ndata: ${JSON.stringify(e)}\n\n`)).join("");
}

function streamResponse(text, status) {
  const bytes = new TextEncoder().encode(text);
  const half = Math.floor(bytes.length / 2);
  const body = new ReadableStream({
    start(c) { c.enqueue(bytes.slice(0, half)); c.enqueue(bytes.slice(half)); c.close(); },
  });
  return new Response(body, { status: status || 200, headers: { "content-type": "text/event-stream" } });
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { "content-type": "application/json" } });
}

// fetch that returns the given responses in order and records each call.
function fakeFetch(...responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return typeof next === "function" ? next(url, init) : next;
  };
  fn.calls = calls;
  return fn;
}

module.exports = { sseBody, streamResponse, jsonResponse, fakeFetch };
