import express from "express";
import bodyParser from "body-parser";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

// --- Configuration ---
const PORT = process.env.PORT || 3000;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "KIRANA_SECRET";
const GEMINI_KEY = process.env.GEMINI_API_KEY;

console.log(`[DEBUG] WHATSAPP_TOKEN starts with: ${WHATSAPP_TOKEN ? WHATSAPP_TOKEN.substring(0, 5) : "MISSING"}`);
console.log(`[DEBUG] PHONE_ID: ${PHONE_ID || "MISSING"}`);

// --- Initialize Firebase Admin ---
let db: admin.firestore.Firestore;

const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
const serviceAccountPath = path.resolve(process.cwd(), "service-account.json");

if (serviceAccountEnv) {
  // Use environment variable (Railway/Cloud)
  const serviceAccount = JSON.parse(serviceAccountEnv);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} else if (fs.existsSync(serviceAccountPath)) {
  // Use local file (Laptop)
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf-8"));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} else {
  // Fallback to simpler initialization if no service account found
  // Note: This might still require authentication depending on environment
  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || "ai-studio-applet-webapp-51469"
  });
}

const firestoreDatabaseId = process.env.FIREBASE_FIRESTORE_DATABASE_ID || "kirana-inventory-db";
console.log(`[INIT] Connecting to Firestore Database: ${firestoreDatabaseId}`);
db = getFirestore(admin.app(), firestoreDatabaseId);

// --- Initialize Gemini AI ---
const genAI = new GoogleGenerativeAI(GEMINI_KEY || "");

const app = express();
app.use(bodyParser.json());

// --- Core Logic: WhatsApp Media Downloader ---
async function downloadWhatsAppMedia(mediaId: string) {
  try {
    // 1. Get Media URL
    const response = await axios.get(`https://graph.facebook.com/v20.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    });
    
    const mediaUrl = response.data.url;
    const mimeType = response.data.mime_type;

    // 2. Download Media Data
    const mediaResponse = await axios.get(mediaUrl, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
      responseType: "arraybuffer"
    });

    return {
      data: Buffer.from(mediaResponse.data).toString("base64"),
      mimeType: mimeType
    };
  } catch (error) {
    console.error("[MEDIA ERROR] Failed to download:", error);
    return null;
  }
}

// --- Core Logic: AI Processing ---
async function parseMessageWithAI(messageText: string, audioData?: string, mimeType?: string) {
  if (!GEMINI_KEY) {
    console.error("Gemini API Key missing.");
    return null;
  }

  const model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash"
  });

  console.log(`[DEBUG] Using Gemini Key starting with: ${GEMINI_KEY ? GEMINI_KEY.substring(0, 5) : "MISSING"}`);

  try {
    const prompt = `
      INSTRUCTION: You are a professional Kirana Shop Inventory Manager. 
      Parse the following intent: ADD, SELL, QUERY, or REPORT. 
      Return JSON only with fields: action, item, quantity, reply, transcript.
      
      USER MESSAGE: ${messageText || "Process this audio."}
    `;
    const parts: any[] = [{ text: prompt }];

    if (audioData && mimeType) {
      parts.push({
        inlineData: {
          mimeType: mimeType,
          data: audioData
        }
      });
    }

    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json"
      }
    });

    const responseText = result.response.text();
    return JSON.parse(responseText.trim());
  } catch (e) {
    console.error("[AI ERROR]", e);
    return null;
  }
}

// --- Core Logic: WhatsApp Message Sender ---
async function sendWhatsAppMessage(to: string, text: string) {
  if (!WHATSAPP_TOKEN || !PHONE_ID) {
    console.error("Missing WhatsApp credentials. Skip sending.");
    return;
  }
  try {
    const url = `https://graph.facebook.com/v20.0/${PHONE_ID}/messages`;
    await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "text",
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`[WA] Sent to ${to}: ${text}`);
  } catch (error: any) {
    console.error("[WA ERROR] Failed to send message:", error.response?.data || error.message);
  }
}

// --- Endpoints ---

// Webhook Verification
app.get("/api/webhook/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("WEBHOOK_VERIFIED");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// Incoming Messages
app.post("/api/webhook/whatsapp", async (req, res) => {
  const body = req.body;

  // 1. Extract message
  let messageText = "";
  let sender = "";
  let audioData = null;
  let mimeType = null;

  if (body.object === "whatsapp_business_account") {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    if (message) {
      sender = message.from;
      if (message.type === "text") {
        messageText = message.text?.body || "";
      } else if (message.type === "audio") {
        console.log(`[WA] Received audio from ${sender}`);
        const media = await downloadWhatsAppMedia(message.audio.id);
        if (media) {
          audioData = media.data;
          mimeType = media.mimeType;
        }
      }
    }
  } else if (body.text) {
    messageText = body.text;
    sender = body.from || "919999999999";
  }

  if (!messageText && !audioData) return res.sendStatus(200);

  console.log(`[WA RECV] ${sender}: ${messageText || "AUDIO"}`);

  // 2. Parse with Gemini
  const aiResult = await parseMessageWithAI(messageText, audioData, mimeType);
  if (!aiResult) return res.sendStatus(200);

  const OWNER_NUMBER = process.env.OWNER_NUMBER || "919999999999";
  let finalReply = aiResult.reply;

  try {
    // SECURITY CHECK: Only owner can modify stock
    const isOwner = sender === OWNER_NUMBER;

    if ((aiResult.action === "ADD" || aiResult.action === "SELL") && !isOwner) {
      await sendWhatsAppMessage(sender, "❌ Unauthorized: Only the shop owner can update inventory.");
      return res.sendStatus(200);
    }

    // 3. Update Firestore
    if (aiResult.action === "ADD" || aiResult.action === "SELL") {
      const itemKey = aiResult.item.toLowerCase().trim();
      const itemRef = db.collection("inventory").doc(itemKey);
      
      await db.runTransaction(async (transaction) => {
        const itemDoc = await transaction.get(itemRef);
        const currentQty = itemDoc.exists ? (itemDoc.data() as any).quantity : 0;
        const newQty = aiResult.action === "ADD" 
          ? currentQty + aiResult.quantity 
          : Math.max(0, currentQty - aiResult.quantity);
        
        transaction.set(itemRef, {
          name: aiResult.item,
          quantity: newQty,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
        finalReply += `\n📦 Current Total: ${newQty}`;
      });

      await db.collection("logs").add({
        sender,
        action: aiResult.action,
        item: aiResult.item,
        quantity: aiResult.quantity,
        transcript: aiResult.transcript || null,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });

    } else if (aiResult.action === "QUERY") {
      const snapshot = await db.collection("inventory").get();
      const items = snapshot.docs.map(d => {
        const data = d.data();
        return `- ${data.name}: ${data.quantity}`;
      });
      
      if (snapshot.empty) {
        finalReply += "\nEmpty / ఖాళీగా ఉంది / खाली है";
      } else {
        finalReply += "\n" + items.join("\n");
      }
    } else if (aiResult.action === "REPORT") {
      // Fetch today's logs
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      
      const logSnapshot = await db.collection("logs")
        .where("timestamp", ">=", admin.firestore.Timestamp.fromDate(startOfDay))
        .get();
      
      const summary = logSnapshot.docs.reduce((acc: any, d) => {
        const data = d.data();
        const key = `${data.action} ${data.item}`;
        acc[key] = (acc[key] || 0) + data.quantity;
        return acc;
      }, {});

      const summaryText = Object.entries(summary)
        .map(([key, val]) => `• ${key}: ${val}`)
        .join("\n");

      finalReply += summaryText ? `\n\n📊 Today's Activity:\n${summaryText}` : "\nNo activity today / आज कोई हलचल नहीं हुई।";
    }

    // 4. Reply via WhatsApp
    await sendWhatsAppMessage(sender, finalReply);

  } catch (error) {
    console.error("[PROCESS ERROR]", error);
  }

  res.status(200).json({ success: true, aiResult });
});

// Health check
app.get("/", (req, res) => res.send("Kirana AI Bot is running..."));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
