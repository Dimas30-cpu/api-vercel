const crypto = require("crypto");

const MAX = 5 * 1024 * 1024;

function slugify(v) {
  return String(v || "").toLowerCase().trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-").slice(0, 50);
}

function sha1(b) { 
  return crypto.createHash("sha1").update(b).digest("hex"); 
}

// ==========================================
// FUNGSI UTILITY JSONBIN
// ==========================================

// 1. Ambil Data Kredensial Admin dari JSONBin
async function getJsonBinData() {
  const binId = process.env.JSONBIN_ID;
  const masterKey = process.env.JSONBIN_MASTER_KEY;

  if (!binId || !masterKey) {
    throw new Error("JSONBIN_ID atau JSONBIN_MASTER_KEY belum diset di Environment Variable Vercel");
  }

  const r = await fetch(`https://api.jsonbin.io/v3/b/${binId}/latest`, {
    method: "GET",
    headers: {
      "X-Master-Key": masterKey
    }
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.message || "Gagal mengambil data dari JSONBin");
  return d.record;
}

// 2. Update Data Kredensial Admin di JSONBin
async function updateJsonBinData(data) {
  const binId = process.env.JSONBIN_ID;
  const masterKey = process.env.JSONBIN_MASTER_KEY;

  if (!binId || !masterKey) {
    throw new Error("JSONBIN_ID atau JSONBIN_MASTER_KEY belum diset di Environment Variable Vercel");
  }

  const r = await fetch(`https://api.jsonbin.io/v3/b/${binId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": masterKey,
      "X-Bin-Versioning": "false"
    },
    body: JSON.stringify({
      username: data.username,
      password: data.password,
      updatedAt: Math.floor(Date.now() / 1000)
    })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.message || "Gagal memperbarui data di JSONBin");
  return d.record;
}

// ==========================================
// FUNGSI UTILITY VERCEL & TELEGRAM
// ==========================================

async function uploadFile(buffer, digest) {
  const r = await fetch("https://api.vercel.com/v2/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
      "Content-Type": "text/html",
      "Content-Length": String(buffer.length),
      "x-vercel-digest": digest
    },
    body: buffer
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`Vercel upload gagal (${r.status}): ${t}`);
}

async function deploy(projectName, digest, size) {
  const r = await fetch("https://api.vercel.com/v13/deployments?skipAutoDetectionConfirmation=1", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: projectName,
      target: "production",
      files: [{ file: "index.html", sha: digest, size }],
      projectSettings: {
        framework: null
      }
    })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || d?.message || "Vercel deployment gagal");
  return d;
}

async function telegram(project, fileName, html, url) {
  const form = new FormData();
  form.append("chat_id", process.env.TELEGRAM_CHAT_ID);
  form.append("caption", [
    "🚀 Dimzz Deploy",
    "",
    `Project: ${project}`,
    `Source: ${fileName}`,
    "Published: index.html",
    `URL: ${url}`
  ].join("\n"));
  form.append("document", new Blob([html], { type: "text/html" }), fileName || `${project}.html`);

  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendDocument`, {
    method: "POST", body: form
  });
  const d = await r.json();
  if (!r.ok || !d.ok) throw new Error(d?.description || "Telegram gagal");
}

// ==========================================
// MAIN HANDLER
// ==========================================

module.exports = async function(req, res) {
  // Config CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();

  const urlPath = req.url || "";

  try {
    if (!process.env.VERCEL_TOKEN) throw new Error("VERCEL_TOKEN belum diset");

    // ---------------------------------------------------------
    // 1. ENDPOINT JSONBIN ADMIN (GET & PUT KREDENSIAL)
    // ---------------------------------------------------------
    
    // GET /api/admin-config -> Mengambil data akun admin dari JSONBin
    if (req.method === "GET" && urlPath.includes("/api/admin-config")) {
      const binData = await getJsonBinData();
      return res.status(200).json({
        success: true,
        data: binData
      });
    }

    // PUT /api/admin-config -> Mengubah username & password admin di JSONBin
    if (req.method === "PUT" && urlPath.includes("/api/admin-config")) {
      const b = req.body || {};
      if (!b.username || !b.password) {
        throw new Error("Username dan password tidak boleh kosong");
      }
      const updated = await updateJsonBinData({
        username: b.username,
        password: b.password
      });
      return res.status(200).json({
        success: true,
        message: "Kredensial admin berhasil diperbarui di JSONBin",
        data: updated
      });
    }

    // ---------------------------------------------------------
    // 2. ENDPOINT GET /api/projects (Pengecekan Daftar Proyek Vercel)
    // ---------------------------------------------------------
    if (req.method === "GET" && (urlPath.includes("/api/projects") || urlPath.endsWith("/projects"))) {
      const r = await fetch("https://api.vercel.com/v9/projects", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.VERCEL_TOKEN}`
        }
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message || "Gagal mengambil proyek dari Vercel");

      return res.status(200).json({
        success: true,
        projects: d.projects || []
      });
    }

    // ---------------------------------------------------------
    // 3. ENDPOINT DELETE /api/projects/:name (Menghapus Proyek Vercel)
    // ---------------------------------------------------------
    if (req.method === "DELETE" && urlPath.includes("/api/projects/")) {
      const projectName = urlPath.split("/").pop();
      if (!projectName) throw new Error("Nama project tidak ditemukan");

      const r = await fetch(`https://api.vercel.com/v9/projects/${projectName}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${process.env.VERCEL_TOKEN}`
        }
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message || "Gagal menghapus proyek dari Vercel");

      return res.status(200).json({
        success: true,
        message: `Project ${projectName} berhasil dihapus`
      });
    }

    // ---------------------------------------------------------
    // 4. ENDPOINT POST /api/deploy (Deployment Vercel + Telegram)
    // ---------------------------------------------------------
    if (req.method === "POST") {
      if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN belum diset");
      if (!process.env.TELEGRAM_CHAT_ID) throw new Error("TELEGRAM_CHAT_ID belum diset");

      const b = req.body || {};
      const project = slugify(b.projectName);
      const fileName = String(b.fileName || `${project}.html`).replace(/[^\w.-]/g, "_");
      const html = typeof b.html === "string" ? b.html : "";

      if (!project) throw new Error("Nama project tidak valid");
      if (!html) throw new Error("HTML kosong");
      if (Buffer.byteLength(html, "utf8") > MAX) throw new Error("HTML maksimal 5 MB");
      if (!/<(?:!doctype\s+html|html[\s>])/i.test(html)) throw new Error("File bukan HTML valid");

      const buffer = Buffer.from(html, "utf8");
      const digest = sha1(buffer);

      await uploadFile(buffer, digest);
      const d = await deploy(project, digest, buffer.length);

      const aliases = Array.isArray(d.alias) ? d.alias : [];
      const alias = aliases.find(x => x === `${project}.vercel.app`) || aliases[0];
      const url = alias ? `https://${alias}` : (d.url ? `https://${d.url}` : `https://${project}.vercel.app`);

      let telegramSent = false, telegramError = null;
      try {
        await telegram(project, fileName, html, url);
        telegramSent = true;
      } catch (e) {
        telegramError = e.message;
      }

      return res.status(200).json({
        success: true,
        projectName: project,
        sourceFile: fileName,
        publishedFile: "index.html",
        url,
        deploymentId: d.id || null,
        telegramSent,
        telegramError
      });
    }

    return res.status(405).json({ success: false, error: "Method Not Allowed" });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, error: e.message || "Internal server error" });
  }
};
