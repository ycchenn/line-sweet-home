const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const UPLOAD_DIR = path.join(__dirname, "uploads");
const DB_PATH = path.join(__dirname, "db.json");

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

function loadDb() {
  if (!fs.existsSync(DB_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(DB_PATH, "utf-8")); }
  catch { return {}; }
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}

let db = loadDb(); // { [id]: entry }

function nowIso() { return new Date().toISOString(); }
function genId() {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `e_${ts}_${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]/g, "_");
    cb(null, `${Date.now()}_${safe}`);
  }
});
const upload = multer({ storage });

/**
 * POST /v1/entries
 * form-data: audio(file), demoMode(true/false optional)
 */
app.post("/v1/entries", upload.single("audio"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "audio file is required" });

  const id = genId();
  const demoMode = (req.body?.demoMode ?? "true") !== "false";

  const entry = {
    id,
    createdAt: nowIso(),
    status: "UPLOADED",
    audio: {
      filename: req.file.filename,
      originalName: req.file.originalname,
      contentType: req.file.mimetype,
      localPath: path.join("uploads", req.file.filename)
    },
    transcript: null,
    ai: { summary3: [], emotion: null, quickReplies: [] },
    reply: { text: null, sentAt: null },
    notification: { text: null, sentAt: null },
    meta: { demoMode, processingMs: null }
  };

  db[id] = entry;
  saveDb(db);
  res.json({ id, status: entry.status });
});

/**
 * POST /v1/entries/:id/process
 * body: { demoMode?: boolean }
 */
app.post("/v1/entries/:id/process", async (req, res) => {
  const { id } = req.params;
  const entry = db[id];
  if (!entry) return res.status(404).json({ error: "entry not found" });

  const demoMode = (req.body?.demoMode ?? entry.meta?.demoMode ?? true) !== false;

  entry.status = "PROCESSING";
  saveDb(db);

  const t0 = Date.now();

  // === DemoMode: 固定輸出（最穩） ===
  // 你可以依不同測資音檔名做不同摘要（可選）
  const fname = (entry.audio?.originalName || "").toLowerCase();
  const isWorried = fname.includes("worry") || fname.includes("sick") || fname.includes("病");

  if (demoMode) {
    entry.transcript = isWorried
      ? "今天去看醫生，血壓有點高，晚上有點睡不好。"
      : "今天去公園散步，遇到老朋友，心情很好。";

    entry.ai = isWorried
      ? {
          summary3: ["今天去看醫生檢查", "血壓偏高有點擔心", "晚上睡得不太好"],
          emotion: "擔心",
          quickReplies: [
            "我有看到，辛苦你了，先好好休息",
            "醫生怎麼說？需要我幫你安排嗎？",
            "記得按時吃藥，我晚點再打給你"
          ]
        }
      : {
          summary3: ["今天去公園散步", "遇到老朋友聊了天", "心情放鬆很開心"],
          emotion: "開心",
          quickReplies: [
            "我有看到～聽起來很棒！",
            "下次也帶我去那個公園",
            "謝謝你跟我分享，記得保暖喔"
          ]
        };

    entry.status = "READY";
    entry.meta.processingMs = Date.now() - t0;
    saveDb(db);

    return res.json({
      id: entry.id,
      status: entry.status,
      ai: entry.ai,
      meta: entry.meta
    });
  }

  // === 非 demoMode（進階） ===
  // 這裡你之後可以接 STT + LLM
  entry.status = "FAILED";
  entry.meta.processingMs = Date.now() - t0;
  saveDb(db);
  return res.status(501).json({ error: "non-demo processing not implemented yet" });
});

/**
 * GET /v1/entries/:id
 */
app.get("/v1/entries/:id", (req, res) => {
  const entry = db[req.params.id];
  if (!entry) return res.status(404).json({ error: "entry not found" });
  res.json(entry);
});

/**
 * POST /v1/entries/:id/reply
 * body: { text: string }
 */
app.post("/v1/entries/:id/reply", (req, res) => {
  const entry = db[req.params.id];
  if (!entry) return res.status(404).json({ error: "entry not found" });

  const text = (req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "text is required" });

  entry.reply.text = text;
  entry.reply.sentAt = nowIso();
  entry.status = "REPLIED";

  entry.notification.text = "孩子已回應 ❤️";
  entry.notification.sentAt = nowIso();

  saveDb(db);
  res.json({
    id: entry.id,
    status: entry.status,
    notification: entry.notification
  });
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`SweetHome API running on http://localhost:${PORT}`);
});
