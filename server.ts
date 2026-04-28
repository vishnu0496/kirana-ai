import express from "express";
import bodyParser from "body-parser";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import axios from "axios";
import { GoogleGenAI, Type } from "@google/genai";
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
const genAI = new GoogleGenAI({ apiKey: GEMINI_KEY || "" });

const app = express();
app.use(bodyParser.json());

// --- Core Logic: WhatsApp Message Sender ---
async function sendWhatsAppMessage(to: string, text: string) {
  if (!WHATSAPP_TOKEN || !PHONE_ID) {
    console.error("Missing WhatsApp credentials. Skip sending.");
    return;
  }
  try {
    const url = `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`;
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

// --- Core Logic: Gemini Inventory Parser ---
async function parseMessageWithAI(message: string) {
  const model = "gemini-3-flash-preview";
  const systemInstruction = `
    You are an inventory assistant for a Kirana shop in India. 
    You understand messages in English, Hindi, and Telugu.
    
    TASKS:
    1. Parse the intent: ADD (stock in), SELL (stock out), or QUERY (check stock).
    2. Extract the item and quantity for ADD/SELL.
    3. Generate a polite reply in the SAME language as the user.
    
    RULES:
    - For QUERY, "item" can be null.
    - For ADD/SELL, provide a JSON.
    
    Examples:
    - "10 sabun aaya" -> { "action": "ADD", "item": "soap", "quantity": 10, "reply": "ठीक है भाई, 10 साबुन जोड़ दिए गए हैं।" }
    - "5 biscuit becha" -> { "action": "SELL", "item": "biscuit", "quantity": 5, "reply": "सरे, 5 बिस्कुट अम्मानु।" }
    - "stock cheppu" -> { "action": "QUERY", "reply": "సరే, ఇక్కడ మీ ఇన్వెంటరీ జాబితా ఉంది:" }
    - "stock dikhao" -> { "action": "QUERY", "reply": "नमस्ते, यहाँ आपका स्टॉक है:" }
  `;

  try {
    const response = await genAI.models.generateContent({
      model: model,
      contents: message,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            action: { type: Type.STRING, enum: ["ADD", "SELL", "QUERY"] },
            item: { type: Type.STRING },
            quantity: { type: Type.NUMBER },
            reply: { type: Type.STRING }
          },
          required: ["action", "reply"]
        }
      }
    });

    if (!response.text) return null;
    return JSON.parse(response.text.trim());
  } catch (e) {
    console.error("[AI ERROR]", e);
    return null;
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

  if (body.object === "whatsapp_business_account") {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    if (message) {
      messageText = message.text?.body || "";
      sender = message.from;
    }
  } else if (body.text) {
    // For manual local testing
    messageText = body.text;
    sender = body.from || "919999999999";
  }

  if (!messageText) return res.sendStatus(200);

  console.log(`[WA RECV] ${sender}: ${messageText}`);

  // 2. Parse with Gemini
  const aiResult = await parseMessageWithAI(messageText);
  if (!aiResult) return res.sendStatus(200);

  let finalReply = aiResult.reply;

  try {
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
