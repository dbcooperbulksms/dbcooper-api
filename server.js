import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fs from "fs";

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;

// File where device activations are stored
const DB_FILE = "./data.json";

// Read activations from file or start fresh
function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return {};
  }
}

// Save activations back to file
function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// Simple health check
app.get("/", (req, res) => {
  res.send("✅ DBcooper API is running.");
});

// Check activation by device code
app.get("/check", (req, res) => {
  const code = (req.query.device || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ ok: false, error: "missing_device_code" });
  const db = readDB();
  const entry = db[code];
  if (!entry) return res.json({ ok: true, status: "not_found" });
  const now = new Date();
  const exp = entry.expiry ? new Date(entry.expiry) : null;
  const active = entry.status === "active" && (!exp || exp > now);
  res.json({
    ok: true,
    device_code: code,
    status: active ? "active" : "inactive",
    plan: entry.plan,
    expiry: entry.expiry,
    notes: entry.notes || ""
  });
});

// Admin: add or update a device manually (optional simple auth)
const ADMIN_KEY = process.env.ADMIN_KEY || "dbcooper-secret";
app.post("/update", (req, res) => {
  const key = req.headers.authorization?.replace("Bearer ", "");
  if (key !== ADMIN_KEY) return res.status(403).json({ ok: false, error: "unauthorized" });
  const { device_code, status, plan, expiry, notes } = req.body;
  if (!device_code) return res.status(400).json({ ok: false, error: "missing_device_code" });
  const db = readDB();
  db[device_code.toUpperCase()] = { status, plan, expiry, notes };
  writeDB(db);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`🚀 DBcooper API running on port ${PORT}`));
