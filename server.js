import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

// ---------- ENV VARS ----------
const ADMIN_KEY  = process.env.ADMIN_KEY  || "dbcooper-secret"; // API key for /update (external)
const BASIC_USER = process.env.BASIC_USER || "admin";           // admin login username
const BASIC_PASS = process.env.BASIC_PASS || "changeme";        // admin login password

// ---------- PERSISTENCE ----------
const DB_FILE = path.join(__dirname, "data.json");
function readDB() { try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch { return {}; } }
function writeDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
if (!fs.existsSync(DB_FILE)) {
  writeDB({
    EXAMPLE01: { status: "active", plan: "Monthly", expiry: "2026-01-31T23:59:59Z", notes: "Test device" }
  });
}

app.use(cors());
app.use(express.json());

// ---------- PUBLIC ----------
app.get("/", (_req, res) => res.send("✅ DBcooper API is running."));

app.get("/check", (req, res) => {
  const code = String(req.query.device || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ ok: false, error: "missing_device_code" });

  const db = readDB();
  const entry = db[code];
  if (!entry) return res.json({ ok: true, device_code: code, status: "not_found" });

  const now = new Date();
  const exp = entry.expiry ? new Date(entry.expiry) : null;
  const active = entry.status === "active" && (!exp || exp > now);

  res.json({
    ok: true,
    device_code: code,
    status: active ? "active" : "inactive",
    plan: entry.plan || "",
    expiry: entry.expiry || "",
    notes: entry.notes || ""
  });
});

// ---------- ADMIN API (external scripts/Postman) ----------
app.post("/update", (req, res) => {
  const auth = req.headers.authorization || "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
  if (key !== ADMIN_KEY) return res.status(403).json({ ok: false, error: "unauthorized" });

  const { device, status, plan, expiry, notes } = req.body || {};
  if (!device) return res.status(400).json({ ok: false, error: "missing_device" });

  const code = String(device).trim().toUpperCase();
  const db = readDB();
  db[code] = { status, plan, expiry, notes };
  writeDB(db);
  res.json({ ok: true, device_code: code, data: db[code] });
});

// ================== ADMIN PANEL (SESSION LOGIN) ==================

const sessions = new Map(); // sid -> { createdAt, lastSeen, ua }

function noStore(_req, res, next) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
}

function parseCookies(cookieHeader = "") {
  return Object.fromEntries(
    cookieHeader.split(";")
      .map(v => v.trim())
      .filter(Boolean)
      .map(kv => {
        const i = kv.indexOf("=");
        return i === -1 ? [kv, ""] : [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))];
      })
  );
}

function requireSession(req, res, next) {
  if (req.path.startsWith("/login")) return next();
  if (req.path.startsWith("/logout")) return next();
  if (req.path.startsWith("/public")) return next();
  if (req.path.startsWith("/api/"))  return next(); // our own admin ajax endpoints check session below

  const sid = parseCookies(req.headers.cookie || "").sid;
  if (!sid || !sessions.has(sid)) return res.redirect(302, "/admin/login");

  const sess = sessions.get(sid);
  if (sess.ua && req.headers["user-agent"] !== sess.ua) {
    sessions.delete(sid);
    return res.redirect(302, "/admin/login");
  }
  const MAX_IDLE_MS = 30 * 60 * 1000;
  if (Date.now() - sess.lastSeen > MAX_IDLE_MS) {
    sessions.delete(sid);
    return res.redirect(302, "/admin/login");
  }
  sess.lastSeen = Date.now();
  next();
}

function requireSessionApi(req, res, next) {
  const sid = parseCookies(req.headers.cookie || "").sid;
  if (!sid || !sessions.has(sid)) return res.status(401).json({ ok: false, error: "not_authenticated" });
  const sess = sessions.get(sid);
  sess.lastSeen = Date.now();
  next();
}

app.use("/admin", noStore, requireSession);

// Login page
app.get("/admin/login", noStore, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Handle login (form or JSON)
app.post("/admin/login", noStore, (req, res) => {
  const tryFinish = (u, p) => {
    if (u === BASIC_USER && p === BASIC_PASS) {
      const sid = crypto.randomUUID();
      sessions.set(sid, { ua: req.headers["user-agent"], createdAt: Date.now(), lastSeen: Date.now() });
      res.setHeader("Set-Cookie", `sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Secure`);
      return res.redirect(302, "/admin");
    }
    return res.status(401).send("Invalid credentials");
  };
  if (req.body && Object.keys(req.body).length) {
    return tryFinish(req.body.username, req.body.password);
  }
  // handle form-urlencoded
  let body = "";
  req.setEncoding("utf8");
  req.on("data", c => body += c);
  req.on("end", () => {
    const p = new URLSearchParams(body);
    tryFinish(p.get("username"), p.get("password"));
  });
});

// Logout
app.post("/admin/logout", noStore, (req, res) => {
  const sid = parseCookies(req.headers.cookie || "").sid;
  if (sid) sessions.delete(sid);
  res.setHeader("Set-Cookie", "sid=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0");
  res.json({ ok: true });
});

// Admin main page
app.get("/admin", noStore, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------- ADMIN AJAX API (secured by session) ----------

// list all devices
app.get("/admin/api/list", noStore, requireSessionApi, (_req, res) => {
  const db = readDB();
  // convert object -> array
  const items = Object.entries(db).map(([device, v]) => ({ device, ...v }));
  items.sort((a, b) => a.device.localeCompare(b.device));
  res.json({ ok: true, items });
});

// save/update one
app.post("/admin/api/save", noStore, requireSessionApi, (req, res) => {
  const { device, status, plan, expiry, notes } = req.body || {};
  if (!device) return res.status(400).json({ ok: false, error: "missing_device" });
  const code = String(device).trim().toUpperCase();
  const db = readDB();
  db[code] = { status, plan, expiry, notes };
  writeDB(db);
  res.json({ ok: true, device: code, data: db[code] });
});

// delete one
app.post("/admin/api/delete", noStore, requireSessionApi, (req, res) => {
  const { device } = req.body || {};
  if (!device) return res.status(400).json({ ok: false, error: "missing_device" });
  const code = String(device).trim().toUpperCase();
  const db = readDB();
  if (db[code]) { delete db[code]; writeDB(db); }
  res.json({ ok: true });
});

// Static assets
app.use("/admin/public", express.static(path.join(__dirname, "public")));

app.listen(PORT, () => console.log(`🚀 DBcooper API + Admin (table & session) on ${PORT}`));
