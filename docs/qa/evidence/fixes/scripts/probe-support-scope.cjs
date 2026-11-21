// Can a restaurant owner read the platform-wide support queue or another restaurant's tickets?
const fs = require("fs");
const seed = fs.readFileSync("D:/restaurant-os-white-label/apps/api/src/scripts/seed-demo-data.ts", "utf8");
const RX = { Owner: /bcrypt\.hash\("(Owner[^"]*)"/, Admin: /bcrypt\.hash\("(Admin[^"]*)"/ };
const pw = (p) => seed.match(RX[p])[1];
const A = "http://localhost:4000/api/v1";
(async () => {
  const L = async (e, p) => (await (await fetch(A + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e, password: p }) })).json()).data;
  const g = async (t, p) => { const r = await fetch(A + p, { headers: { Authorization: "Bearer " + t } }); return [r.status, await r.json()]; };
  const o = await L("owner@demo-restaurant.local", pw("Owner"));
  const other = await L("amara@spice-route.local", pw("Owner"));
  const ad = await L("platform-admin@restaurant.local", pw("Admin"));
  const rid = String(o.user.restaurantId);
  const [s1, j1] = await g(o.accessToken, "/support/admin/tickets?limit=50");
  const [s2, j2] = await g(ad.accessToken, "/support/admin/tickets?limit=50");
  const ot = j1.data?.tickets || [];
  const at = j2.data?.tickets || [];
  console.log("owner GET /support/admin/tickets →", s1, ot.length, "tickets; from other restaurants:", ot.filter((t) => String(t.restaurantId) !== rid).length, j1.error?.message || "");
  console.log("platform admin →", s2, at.length, "tickets; restaurants:", [...new Set(at.map((t) => t.restaurantName))].join(", "));
  const foreign = at.find((t) => t.restaurantId && String(t.restaurantId) !== rid);
  if (foreign) {
    const [s3, j3] = await g(o.accessToken, `/support/tickets/${foreign.id}`);
    console.log("owner opening another restaurant's ticket →", s3, j3.error?.message || "(data returned)");
  } else console.log("no other-restaurant ticket in the seed");
  const [s4, j4] = await g(other.accessToken, "/support/admin/tickets?limit=50");
  console.log("Spice Route owner GET /support/admin/tickets →", s4, (j4.data?.tickets || []).length, "tickets; not their own:", (j4.data?.tickets || []).filter((t) => String(t.restaurantId) !== String(other.user.restaurantId)).length);
})();

// Cross-restaurant check with a real ticket from Spice Route.
(async () => {
  await new Promise((r) => setTimeout(r, 1500));
  const L = async (e, p) => (await (await fetch(A + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e, password: p }) })).json()).data;
  const other = await L("amara@spice-route.local", pw("Owner"));
  const o = await L("owner@demo-restaurant.local", pw("Owner"));
  const c = await fetch(A + "/support/tickets", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + other.accessToken }, body: JSON.stringify({ subject: "QA isolation check", description: "Created by the QA isolation probe." }) });
  const t = (await c.json()).data?.ticket;
  const r = await fetch(A + `/support/tickets/${t.id}`, { headers: { Authorization: "Bearer " + o.accessToken } });
  const m = await fetch(A + `/support/tickets/${t.id}/messages`, { headers: { Authorization: "Bearer " + o.accessToken } });
  const list = await (await fetch(A + `/restaurants/${o.user.restaurantId}/support/tickets`, { headers: { Authorization: "Bearer " + o.accessToken } })).json();
  console.log("Spice Route ticket created:", c.status, "| Wildwood owner opens it →", r.status, "| its messages →", m.status, "| appears in Wildwood list:", (list.data?.tickets || []).some((x) => x.id === t.id));
})();
