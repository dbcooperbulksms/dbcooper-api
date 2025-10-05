import express from "express";
import cors from "cors";

const app = express();
const port = process.env.PORT || 10000;
const ADMIN_KEY = process.env.ADMIN_KEY;

app.use(cors());
app.use(express.json());

let activations = {
  EXAMPLE01: {
    status: "active",
    plan: "Monthly",
    expiry: "2026-01-31T23:59:59Z",
    notes: "Test device"
  }
};

// Check endpoint
app.get("/check", (req, res) => {
  const { device } = req.query;
  const data = activations[device];
  if (!data) return res.json({ ok: false, device_code: device, status: "not_found" });
  res.json({ ok: true, device_code: device, ...data });
});

// Update endpoint (admin only)
app.post("/update", (req, res) => {
  const key = req.headers.authorization;
  if (key !== ADMIN_KEY) return res.status(401).json({ ok: false, error: "unauthorized" });

  const { device, status, plan, expiry, notes } = req.body;
  activations[device] = { status, plan, expiry, notes };
  res.json({ ok: true, updated: activations[device] });
});

app.listen(port, () => console.log(`🚀 DBcooper API running on port ${port}`));

