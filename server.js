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
const ADMIN_KEY  = process.env.ADMIN_KEY  || "dbcooper-secret"; // API key for /update
const BASIC_USER = process.env.BASIC_USER || "admin";           // login username
const BASIC_PASS = process.env.BASIC_PASS || "changeme";        // login password

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

// ---------- ADMIN API (for scripts/Postman) ----------
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

// in-memory session store: sid -> { createdAt, ua }
const sessions = new Map();

// Middleware: set strict no-cache headers on admin pages
function noStore(req, res, next) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
}

// Parse Cookie header
function parseCookies(cookieHeader = "") {
  return Object.fromEntries(
    cookieHeader.split(";").map(v => v.trim()).filter(Boolean).map(kv => {
      const idx = kv.indexOf("=");
      return idx === -1 ? [kv, ""] : [kv.slice(0, idx), decodeURIComponent(kv.slice(idx + 1))];
    })
  );
}

// Require session for /admin (except /admin/login and /admin/logout endpoints)
function requireSession(req, res, next) {
  if (req.path.startsWith("/login")) return next();
  if (req.path.startsWith("/logout")) return next();
  if (req.path.startsWith("/public")) return next();

  const cookies = parseCookies(req.headers.cookie || "");
  const sid = cookies.sid;
  if (!sid || !sessions.has(sid)) {
    // not logged in -> redirect to login
    return res.redirect(302, "/admin/login");
  }
  // optional: bind to user-agent to reduce token reuse
  const sess = sessions.get(sid);
  if (sess.ua && req.headers["user-agent"] !== sess.ua) {
    sessions.delete(sid);
    return res.redirect(302, "/admin/login");
  }
  // short idle timeout (e.g., 30 minutes)
  const MAX_IDLE_MS = 30 * 60 * 1000;
  if (Date.now() - sess.lastSeen > MAX_IDLE_MS) {
    sessions.delete(sid);
    return res.redirect(302, "/admin/login");
  }
  sess.lastSeen = Date.now();
  next();
}

app.use("/admin", noStore, requireSession);

// Login page
app.get("/admin/login", noStore, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Handle login
app.post("/admin/login", noStore, (req, res) => {
  // Accept JSON or form
  const { username, password } = (req.body && Object.keys(req.body).length) ? req.body : {};
  // For simple forms (URL-encoded), parse manually if needed
  if (!username || !password) {
    // try to parse urlencoded payload
    let bodyStr = "";
    req.setEncoding("utf8");
    req.on("data", chunk => bodyStr += chunk);
    req.on("end", () => {
      const params = new URLSearchParams(bodyStr);
      const u = params.get("username");
      const p = params.get("password");
      if (u === BASIC_USER && p === BASIC_PASS) {
        const sid = crypto.randomUUID();
        sessions.set(sid, { ua: req.headers["user-agent"], createdAt: Date.now(), lastSeen: Date.now() });
        // Session cookie (no Max-Age): expires when browser closes.
        res.setHeader("Set-Cookie", `sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Secure`);
        return res.redirect(302, "/admin");
      }
      return res.status(401).send("Invalid credentials");
    });
  } else {
    if (username === BASIC_USER && password === BASIC_PASS) {
      const sid = crypto.randomUUID();
      sessions.set(sid, { ua: req.headers["user-agent"], createdAt: Date.now(), lastSeen: Date.now() });
      res.setHeader("Set-Cookie", `sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Secure`);
      return res.json({ ok: true, redirect: "/admin" });
    }
    return res.status(401).json({ ok: false, error: "invalid_credentials" });
  }
});

// Logout (called by button and on tab close)
app.post("/admin/logout", noStore, (req, res) => {
  const cookies = parseCookies(req.headers.cookie || "");
  const sid = cookies.sid;
  if (sid) sessions.delete(sid);
  // Clear cookie
  res.setHeader("Set-Cookie", "sid=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0");
  res.json({ ok: true });
});

// Admin main page (requires session)
app.get("/admin", noStore, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Admin save (requires session)
app.post("/admin/update", noStore, (req, res) => {
  const { device, status, plan, expiry, notes } = req.body || {};
  if (!device) return res.status(400).json({ ok: false, error: "missing_device" });

  const code = String(device).trim().toUpperCase();
  const db = readDB();
  db[code] = { status, plan, expiry, notes };
  writeDB(db);
  res.json({ ok: true, device_code: code, data: db[code] });
});

// Static assets
app.use("/admin/public", express.static(path.join(__dirname, "public")));

app.listen(PORT, () => console.log(`🚀 DBcooper API + Admin (session login) running on ${PORT}`));
