import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import fs from "fs";

// Load env variables
dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Telegram configuration with robust fallbacks
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8720059439:AAH4PJq5nt13G6YMweoS2x88mpKAJSl0vBk";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "8783921961";

// API endpoints for Telegram Proxy
app.post("/api/telegram/send", async (req, res) => {
  try {
    const { text, parse_mode } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    const apiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: parse_mode || "HTML"
      })
    });

    const data = await response.json();
    if (!data.ok) {
      console.warn("Telegram sendMessage returned non-OK status:", data.description || data);
      return res.json({
        ok: true,
        success: false,
        message: "Message delivery skipped or failed gracefully: " + (data.description || "Unknown")
      });
    }
    return res.json(data);
  } catch (error: any) {
    console.error("Error in send proxy:", error.message || error);
    return res.json({ ok: true, success: false, error: error.message || "Failed to send message" });
  }
});

app.post("/api/telegram/send-video", (req, res) => {
  // Respond immediately to the client to prevent connection pooling timeouts and fetch blockages
  res.json({ status: "queued", message: "Video broadcast queued successfully", ok: true });

  // Handle the video broadcast to Telegram asynchronously in the background
  (async () => {
    try {
      const { chat_id, video, caption, parse_mode } = req.body;
      let targetChatId = chat_id || TELEGRAM_CHAT_ID;
      if (targetChatId === "-1004147978833") {
        targetChatId = TELEGRAM_CHAT_ID;
      }
      const host = req.get("host") || "localhost:3000";
      const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
      const protocol = isHttps ? "https" : "http";
      const domainUrl = `${protocol}://${host}`;
      const videoUrl = video || `${domainUrl}/my-video.mp4`;
      const selectedParseMode = parse_mode || "HTML";

      const apiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendVideo`;
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: targetChatId,
          video: videoUrl,
          caption: caption || "",
          parse_mode: selectedParseMode
        })
      });

      const data = await response.json();
      if (!data.ok) {
        console.warn("Telegram API returned non-OK status for sendVideo, falling back to sendMessage:", data.description || data);
        
        // Fallback to sending a text message with the caption to make sure it delivers
        const fallbackUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        
        let finalSuccess = false;
        try {
          const fbResponse = await fetch(fallbackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: targetChatId,
              text: `📹 <b>[ভিডিও লোড হয়নি, রিপোর্ট নিচে দেওয়া হলো]</b>\n\n${caption || ""}`,
              parse_mode: "HTML"
            })
          });
          const fbData = await fbResponse.json();
          if (fbData.ok) {
            finalSuccess = true;
          } else {
            console.warn("Fallback sendMessage to targetChatId also failed:", fbData.description || fbData);
          }
        } catch (fbErr: any) {
          console.error("Fallback fetch error:", fbErr.message);
        }

        // If targetChatId delivery failed, fall back to the primary TELEGRAM_CHAT_ID (which is tested & working)
        if (!finalSuccess && targetChatId !== TELEGRAM_CHAT_ID) {
          console.log("Attempting ultimate fallback to primary TELEGRAM_CHAT_ID:", TELEGRAM_CHAT_ID);
          try {
            const primaryFbResponse = await fetch(fallbackUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: `📹 <b>[চ্যানেল নট ফাউন্ড - মেইন চ্যাটে পাঠানো হলো]</b>\n\n${caption || ""}`,
                parse_mode: "HTML"
              })
            });
            const primaryFbData = await primaryFbResponse.json();
            if (!primaryFbData.ok) {
              console.error("Ultimate fallback to TELEGRAM_CHAT_ID also failed:", primaryFbData.description || primaryFbData);
            } else {
              console.log("Telemetry successfully redirected to primary TELEGRAM_CHAT_ID.");
            }
          } catch (primaryFbErr: any) {
            console.error("Ultimate fallback fetch error:", primaryFbErr.message);
          }
        }
      }
    } catch (err: any) {
      console.error("Background video send error:", err.message);
    }
  })();
});

app.get("/api/telegram/updates", async (req, res) => {
  try {
    const offset = req.query.offset || "";
    const apiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${offset}`;
    
    const response = await fetch(apiUrl);
    const data = await response.json();
    if (!data.ok) {
      console.warn("Telegram getUpdates returned non-OK:", data.description || data);
      return res.json({ ok: true, result: [] });
    }
    return res.json(data);
  } catch (error: any) {
    console.error("Error in updates proxy:", error.message || error);
    return res.json({ ok: true, result: [] });
  }
});

// Explicit routes to serve static assets uploaded to the GitHub root folder on Render.com
app.get("/my-logo.jpg", (req, res, next) => {
  const filePath = path.join(process.cwd(), "my-logo.jpg");
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    next();
  }
});

app.get("/my-logo1.jpg", (req, res, next) => {
  const filePath = path.join(process.cwd(), "my-logo1.jpg");
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    next();
  }
});

app.get("/my-video.mp4", (req, res, next) => {
  const filePath = path.join(process.cwd(), "my-video.mp4");
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    next();
  }
});

// Vite middleware setup
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

setupVite().catch((err) => {
  console.error("Failed to start server", err);
});
