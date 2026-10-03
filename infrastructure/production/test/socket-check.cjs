// Phase 86 edge test helper — run inside the API image (it ships socket.io-client) on the edge
// network, resolving GarnishTable/restaurant hostnames to Caddy and trusting Pebble's test root.
//
//   node socket-check.cjs live   <origin> <apiUrl> <token> <restaurantId> <menuItemId> <holdSeconds>
//   node socket-check.cjs reject <origin> <apiUrl> <token>
//
// Prints one JSON line with the outcome.
const { io } = require("socket.io-client");

const [mode, origin, apiUrl, token, restaurantId, menuItemId, holdSeconds] = process.argv.slice(2);
const out = (result) => {
  console.log(JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
};

function connect(transports) {
  return io(apiUrl, { transports, auth: { token }, reconnection: false, timeout: 10000, extraHeaders: { Origin: origin } });
}

if (mode === "reject") {
  const results = {};
  let pending = 2;
  for (const transport of ["polling", "websocket"]) {
    const socket = connect([transport]);
    socket.on("connect", () => {
      results[transport] = "connected";
      socket.disconnect();
      if (--pending === 0) out({ ok: false, mode, origin, results });
    });
    socket.on("connect_error", (err) => {
      results[transport] = `rejected: ${err.message}`;
      socket.disconnect();
      if (--pending === 0) out({ ok: Object.values(results).every((r) => r.startsWith("rejected")), mode, origin, results });
    });
  }
} else {
  const socket = connect(["polling", "websocket"]);
  const result = { mode, origin, transport: null, orderEvent: null, connectedAfterHold: null };
  const timer = setTimeout(() => out({ ok: false, ...result, error: "timeout" }), (Number(holdSeconds) + 60) * 1000);
  socket.on("connect_error", (err) => out({ ok: false, ...result, error: `connect_error: ${err.message}` }));
  socket.on("order:event", (event) => {
    if (event.type === "order.created" && !result.orderEvent) result.orderEvent = event.orderNumber ?? event.orderId ?? "received";
  });
  socket.on("connect", async () => {
    // Give the polling→websocket upgrade a moment so the upgraded transport is what's held.
    await new Promise((r) => setTimeout(r, 2000));
    result.transport = socket.io.engine.transport.name;
    // Place a real order through the restaurant's custom domain; the API must push it to this socket.
    const res = await fetch(`${origin}/api/v1/restaurants/${restaurantId}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ items: [{ menuItemId, quantity: 1 }], orderType: "pickup", paymentMethod: "cash" }),
    });
    result.orderStatus = res.status;
    if (res.status !== 201) result.orderError = (await res.text()).slice(0, 200);
    for (let i = 0; i < 20 && !result.orderEvent; i++) await new Promise((r) => setTimeout(r, 500));
    // Hold the connection open through several Socket.IO heartbeats (25s interval).
    await new Promise((r) => setTimeout(r, Number(holdSeconds) * 1000));
    result.connectedAfterHold = socket.connected;
    clearTimeout(timer);
    socket.disconnect();
    out({ ok: result.orderStatus === 201 && Boolean(result.orderEvent) && result.connectedAfterHold === true, ...result });
  });
}
