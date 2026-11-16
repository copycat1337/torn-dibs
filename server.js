import http from "node:http";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { openDatabase } from "./db/connection.js";

dotenv.config();

const PORT        = Number(process.env.PORT || 3000);
const API_TOKEN   = (process.env.API_TOKEN || "").trim();
const FACTION_ID  = (process.env.FACTION_ID || "").trim();
const TORN_BASE   = "https://api.torn.com/v2";

let db;
try {
  db = openDatabase();
} catch (e) {
  if (e.code === "DB_NOT_FOUND") {
    console.error(`[server] ${e.message}`);
    process.exit(1);
  }
  throw e;
}

const stmt = {
  insertUser: db.prepare(
    `INSERT OR REPLACE INTO users (token, player_id, player_name, faction_id, torn_api_key)
     VALUES (?, ?, ?, ?, ?)`
  ),
  getUserByToken: db.prepare(`SELECT * FROM users WHERE token = ?`),
  listCalls: db.prepare(
    `SELECT id, faction_id, member_id, member_name, caller_id, caller_name, created_at
     FROM calls WHERE faction_id = ?`
  ),
  getCallByMember: db.prepare(
    `SELECT * FROM calls WHERE faction_id = ? AND member_id = ?`
  ),
  getCallByCaller: db.prepare(
    `SELECT * FROM calls WHERE faction_id = ? AND caller_id = ?`
  ),
  getCallById: db.prepare(`SELECT * FROM calls WHERE id = ?`),
  insertCall: db.prepare(
    `INSERT INTO calls (id, faction_id, member_id, member_name, caller_id, caller_name)
     VALUES (?, ?, ?, ?, ?, ?)`
  ),
  deleteCall: db.prepare(`DELETE FROM calls WHERE id = ?`),
  listStatuses: db.prepare(
    `SELECT member_id, status, until, previous_area, updated_at
     FROM statuses WHERE faction_id = ?`
  ),
  upsertStatus: db.prepare(
    `INSERT INTO statuses (faction_id, member_id, status, until, previous_area, updated_at)
     VALUES (?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(faction_id, member_id) DO UPDATE SET
       status = excluded.status,
       until = excluded.until,
       previous_area = excluded.previous_area,
       updated_at = unixepoch()`
  ),
  getAllFactions: db.prepare(`SELECT DISTINCT faction_id FROM users`),
  getUserByFaction: db.prepare(`SELECT torn_api_key FROM users WHERE faction_id = ? AND torn_api_key IS NOT NULL LIMIT 1`),
};

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data),
    "Access-Control-Allow-Origin": "https://www.torn.com",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  });
  res.end(data);
}

function cors(res) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "https://www.torn.com",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  });
  res.end();
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return null; }
}

function bearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

function authUser(req) {
  const token = bearer(req);
  if (!token) return null;
  if (API_TOKEN) return token === API_TOKEN ? { token, player_id: null, faction_id: FACTION_ID } : null;
  return stmt.getUserByToken.get(token) || null;
}

function resolveFaction(user, queryOrBody) {
  if (API_TOKEN) {
    const fromClient = (queryOrBody?.factionId || "").trim();
    return fromClient || FACTION_ID || null;
  }
  return (user?.faction_id || "").trim() || null;
}

async function handleRegister(req, res) {
  const body = await readJson(req);
  if (body === null) return json(res, 400, { success: false, error: "invalid_json" });
  const key = (body.tornApiKey || "").trim();
  if (!key) return json(res, 400, { success: false, error: "missing_key" });

  let torn;
  try {
    const r = await fetch(`${TORN_BASE}/user/profile?key=${encodeURIComponent(key)}`);
    torn = await r.json();
  } catch {
    return json(res, 502, { success: false, error: "torn_unreachable" });
  }
  const p = torn?.profile;
  if (!p?.id) return json(res, 401, { success: false, error: "bad_key" });

  const token = crypto.randomBytes(24).toString("hex");
  const factionId = String(p.faction_id || "");
  stmt.insertUser.run(token, String(p.id), p.name || null, factionId, key);

  return json(res, 200, {
    success: true,
    token,
    playerId: String(p.id),
    playerName: p.name || null,
    factionId: factionId || null,
  });
}

function handleGetCalls(req, res, url) {
  const user = authUser(req);
  if (!user) return json(res, 401, { success: false, error: "unauthorized" });

  const factionId = resolveFaction(user, { factionId: url.searchParams.get("factionId") });
  if (!factionId) return json(res, 400, { success: false, error: "no_faction" });

  const calls = stmt.listCalls.all(factionId).map(c => ({
    id: c.id,
    factionId: c.faction_id,
    memberId: c.member_id,
    memberName: c.member_name,
    callerId: c.caller_id,
    callerName: c.caller_name,
    createdAt: c.created_at,
  }));

  const statuses = stmt.listStatuses.all(factionId).map(s => ({
    memberId: s.member_id,
    status: s.status,
    until: s.until,
    previousArea: s.previous_area,
    updatedAt: s.updated_at,
  }));

  return json(res, 200, { success: true, calls, statuses, timestamp: Date.now() });
}

async function handlePostCall(req, res) {
  const user = authUser(req);
  if (!user) return json(res, 401, { success: false, error: "unauthorized" });

  const body = await readJson(req);
  if (body === null) return json(res, 400, { success: false, error: "invalid_json" });

  const factionId = resolveFaction(user, body);
  if (!factionId) return json(res, 400, { success: false, error: "no_faction" });

  const memberId   = String(body.memberId || "").trim();
  const memberName = (body.memberName || "").toString().slice(0, 80);
  if (!memberId) return json(res, 400, { success: false, error: "missing_ids" });

  let callerId, callerName;
  if (API_TOKEN) {
    callerId   = String(body.callerId || "").trim();
    callerName = (body.callerName || "").toString().slice(0, 80);
    if (!callerId) return json(res, 400, { success: false, error: "missing_ids" });
  } else {
    callerId   = String(user.player_id);
    callerName = user.player_name || "";
  }

  const byMember = stmt.getCallByMember.get(factionId, memberId);
  if (byMember) {
    return json(res, 200, {
      success: false,
      error: "already_called",
      existingCaller: byMember.caller_name,
      callId: byMember.id,
      targetName: byMember.member_name,
    });
  }
  const byCaller = stmt.getCallByCaller.get(factionId, callerId);
  if (byCaller) {
    return json(res, 200, {
      success: false,
      error: "caller_already_has_call",
      callId: byCaller.id,
      targetName: byCaller.member_name,
    });
  }

  const id = crypto.randomBytes(8).toString("hex");
  stmt.insertCall.run(id, factionId, memberId, memberName || null, callerId, callerName || null);

  return json(res, 200, {
    success: true,
    data: { id, memberId, memberName },
  });
}

function handleCancelCall(req, res, id) {
  const user = authUser(req);
  if (!user) return json(res, 401, { success: false, error: "unauthorized" });

  const row = stmt.getCallById.get(id);
  if (!row) return json(res, 200, { success: true });

  if (!API_TOKEN && row.faction_id !== user.faction_id) {
    return json(res, 200, { success: false, error: "not_owner" });
  }
  if (!API_TOKEN && row.caller_id !== String(user.player_id)) {
    return json(res, 200, { success: false, error: "not_owner", ownerName: row.caller_name });
  }

  stmt.deleteCall.run(id);
  return json(res, 200, { success: true, data: { memberId: row.member_id } });
}

async function handleStatusUpdate(req, res) {
  const user = authUser(req);
  if (!user) return json(res, 401, { success: false, error: "unauthorized" });

  const body = await readJson(req);
  if (body === null) return json(res, 400, { success: false, error: "invalid_json" });

  const factionId = resolveFaction(user, body);
  if (!factionId) return json(res, 400, { success: false, error: "no_faction" });

  const statuses = Array.isArray(body.statuses) ? body.statuses : [];
  const tx = db.transaction(rows => {
    for (const s of rows) {
      if (!s?.memberId) continue;
      stmt.upsertStatus.run(
        factionId,
        String(s.memberId),
        s.status || null,
        typeof s.until === "number" ? s.until : null,
        typeof s.previousArea === "number" ? s.previousArea : null
      );
    }
  });
  tx(statuses);
  return json(res, 200, { success: true, count: statuses.length });
}

function handleHeartbeat(req, res) {
  const user = authUser(req);
  if (!user) return json(res, 401, { success: false, error: "unauthorized" });
  return json(res, 200, { success: true, timestamp: Date.now() });
}

async function pollFactionStatuses(factionId, apiKey) {
  try {
    const url = `https://api.torn.com/v2/faction/${factionId}?selections=basic,members&key=${apiKey}`;
    const r = await fetch(url);
    if (!r.ok) return;
    const data = await r.json();
    if (!data || !data.members) return;
    
    const statuses = [];
    for (const [id, member] of Object.entries(data.members)) {
      statuses.push({
        memberId: id,
        status: member.status.state,
        until: member.status.until || null,
        previousArea: member.status.plane || null
      });
    }
    
    if (statuses.length) {
      const tx = db.transaction(rows => {
        for (const s of rows) {
          stmt.upsertStatus.run(
            factionId,
            String(s.memberId),
            s.status || null,
            typeof s.until === "number" ? s.until : null,
            typeof s.previousArea === "number" ? s.previousArea : null
          );
        }
      });
      tx(statuses);
    }
  } catch (e) {
    console.error(`[server] poll error for faction ${factionId}:`, e.message);
  }
}

function startBackgroundPoller() {
  setInterval(async () => {
    try {
      const factions = stmt.getAllFactions.all();
      for (const f of factions) {
        if (!f.faction_id) continue;
        const user = stmt.getUserByFaction.get(f.faction_id);
        if (user && user.torn_api_key) {
          await pollFactionStatuses(f.faction_id, user.torn_api_key);
        }
      }
    } catch (e) {
      console.error("[server] background poller error:", e);
    }
  }, 10000);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  if (req.method === "OPTIONS") return cors(res);

  try {
    if (req.method === "GET" && pathname === "/health") {
      return json(res, 200, { success: true, ok: true });
    }
    if (req.method === "POST" && pathname === "/api/register") {
      return await handleRegister(req, res);
    }
    if (req.method === "GET" && pathname === "/api/calls") {
      return handleGetCalls(req, res, url);
    }
    if (req.method === "POST" && pathname === "/api/call") {
      return await handlePostCall(req, res);
    }
    const m = pathname.match(/^\/api\/call\/([^/]+)\/cancel$/);
    if (req.method === "POST" && m) {
      return handleCancelCall(req, res, decodeURIComponent(m[1]));
    }
    if (req.method === "POST" && pathname === "/api/status-update") {
      return await handleStatusUpdate(req, res);
    }
    if (req.method === "POST" && pathname === "/api/heartbeat") {
      return handleHeartbeat(req, res);
    }
    return json(res, 404, { success: false, error: "not_found" });
  } catch (e) {
    console.error("[server] unhandled:", e);
    return json(res, 500, { success: false, error: "server_error" });
  }
});

server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] auth mode: ${API_TOKEN ? "shared API_TOKEN" : "per-user token (users table)"}`);
  console.log(`[server] default faction: ${FACTION_ID || "(none — clients must send factionId)"}`);
  startBackgroundPoller();
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`\n[server] ${sig} — closing db`);
    try { db.close(); } catch {}
    server.close(() => process.exit(0));
  });
}