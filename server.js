import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

// ---------- ENV VARS ----------
const ADMIN_KEY  = process.env.ADMIN_KEY  || "dbcooper-secret";   // for /update via API
const BASIC_USER = process.env.BASIC_USER || "admin";             // for /admin web panel
const BASIC_PASS = process.env.BASIC_PASS || "changeme";

// ---------- PERSISTENCE ----------
const DB_FILE = path.join(__dirname, "data.json");

function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return {}; }
}
function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ensure file exists (seed EXAMPLE01 once)
if (!fs.existsSync(DB_FILE)) {
  writeDB({
    EXAMPLE01: {
      status: "active",
      plan: "Monthly",
      expiry: "2026-01-31T23:59:59Z",
      notes: "Test device"
    }
  });
}

app.use(cors());
app.use(express.json());

// ---------- HOME ----------
app.get("/", (_req, res) => res.send("✅ DBcooper API is running."));

// ---------- PUBLIC: check ----------
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

// ---------- ADMIN API (Authorization: Bearer <ADMIN_KEY>) ----------
app.post("/update", (req, res) => {
  const auth = req.headers.authorization || "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7) : auth;

  if (key !== ADMIN_KEY) {
    return res.status(403).json({ ok: false, error: "unauthorized" });
  }

  const { device, status, plan, expiry, notes } = req.body || {};
  if (!device) return res.status(400).json({ ok: false, error: "missing_device" });

  const code = String(device).trim().toUpperCase();
  const db = readDB();
  db[code] = { status, plan, expiry, notes };
  writeDB(db);

  res.json({ ok: true, device_code: code, data: db[code] });
});

// ---------- ADMIN WEB (Basic Auth) ----------
function basicAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="DBcooper Admin"');
    return res.status(401).send("Authentication required");
  }
  const [u, p] = Buffer.from(auth.slice(6), "base64").toString("utf8").split(":");
  if (u === BASIC_USER && p === BASIC_PASS) return next();
  res.set("WWW-Authenticate", 'Basic realm="DBcooper Admin"');
  return res.status(401).send("Unauthorized");
}

app.use("/admin", basicAuth);

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// browser -> our server (no ADMIN_KEY exposure)
app.post("/admin/update", (req, res) => {
  const { device, status, plan, expiry, notes } = req.body || {};
  if (!device) return res.status(400).json({ ok: false, error: "missing_device" });

  const code = String(device).trim().toUpperCase();
  const db = readDB();
  db[code] = { status, plan, expiry, notes };
  writeDB(db);

  res.json({ ok: true, device_code: code, data: db[code] });
});

// static assets
app.use("/admin/public", express.static(path.join(__dirname, "public")));

app.listen(PORT, () => console.log(`🚀 DBcooper API + Admin running on ${PORT}`));
