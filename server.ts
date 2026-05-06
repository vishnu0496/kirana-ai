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
// Note: reserved for future media support
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
async function parseMessageWithAI(messageText: string): Promise<ParsedAction | null> {
  if (!GEMINI_KEY) {
    console.error("Gemini API Key missing.");
    return null;
  }

  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  try {
    const prompt = `
      INSTRUCTION: You are a professional Kirana Shop Inventory Manager.
      Understand the user's intent: ADD, SELL, QUERY, or REPORT.
      Extract item and quantity for ADD/SELL.
      Reply in the user's language (English, Hindi, or Telugu).

      EXAMPLES OF TELUGU/HINDI PATTERNS:
      - "padi X vachayi" = ADD X items
      - "X aaya / aaye" = ADD X items  
      - "X becha / bech diya" = SELL X items
      - "stock dikhao / inventory batao" = QUERY
      - Numbers in Telugu: padi=10, anu=5, rendu=2, okati=1

      RULES:
      1. If quantity is mentioned as a word like 'padi' (10 in Telugu), convert it to the number.
      2. If you cannot determine the action with confidence, return action: QUERY with a reply asking the user to clarify.
      3. Always return valid JSON.
      
      You MUST return a strict JSON object with this exact structure:
      {
        "action": "ADD" | "SELL" | "QUERY" | "REPORT",
        "item": "string (item name, or empty string)",
        "quantity": number (positive integer, or 0),
        "reply": "string (your conversational reply)"
      }
      
      USER MESSAGE: ${messageText}
    `;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    });

    let parsedResult;
    try {
      parsedResult = JSON.parse(result.response.text().trim());
    } catch (parseError) {
      return null;
    }

    if (!isValidParsedAction(parsedResult)) {
      console.error("[AI INVALID] Invalid action from AI:", parsedResult);
      return null;
    }

    return parsedResult;
  } catch (e) {
    console.error("[AI ERROR]", e);
    return null;
  }
}

// --- Core Logic: Rule-Based Parser & Validation ---
interface ParsedAction {
  action: "ADD" | "SELL" | "QUERY" | "REPORT";
  item: string;
  quantity: number;
  reply: string;
}

function parseMessageRuleBased(messageText: string): ParsedAction | null {
  const text = messageText.toLowerCase().trim();

  if (text === "show inventory" || text === "inventory") {
    return { action: "QUERY", item: "", quantity: 0, reply: "Here is your current inventory:" };
  }
  if (text === "today report" || text === "report") {
    return { action: "REPORT", item: "", quantity: 0, reply: "Here is today's report:" };
  }

  const addMatch = text.match(/^add\s+(\d+)\s+(.+)$/i);
  if (addMatch) {
    return { action: "ADD", quantity: parseInt(addMatch[1], 10), item: addMatch[2].trim(), reply: `Added ${addMatch[1]} ${addMatch[2].trim()}` };
  }

  const sellMatch = text.match(/^(?:sold|sell)\s+(\d+)\s+(.+)$/i);
  if (sellMatch) {
    return { action: "SELL", quantity: parseInt(sellMatch[1], 10), item: sellMatch[2].trim(), reply: `Sold ${sellMatch[1]} ${sellMatch[2].trim()}` };
  }

  return null;
}

function isValidParsedAction(result: any): result is ParsedAction {
  if (!result || typeof result !== "object") return false;
  if (!["ADD", "SELL", "QUERY", "REPORT"].includes(result.action)) return false;
  
  if (result.action === "ADD" || result.action === "SELL") {
    if (typeof result.item !== "string" || result.item.trim() === "") return false;
    if (typeof result.quantity !== "number" || result.quantity <= 0) return false;
  }
  
  if (typeof result.reply !== "string") return false;
  return true;
}

// --- Core Logic: Database Processors ---
async function processAddSell(sender: string, parsed: ParsedAction): Promise<string> {
  const shopRef = db.collection("shops").doc(sender);
  const inventoryRef = shopRef.collection("inventory");
  const logsRef = shopRef.collection("logs");

  const itemKey = parsed.item.toLowerCase().trim();
  const itemDocRef = inventoryRef.doc(itemKey);
  
  let newQty = 0;
  await db.runTransaction(async (transaction) => {
    const itemDoc = await transaction.get(itemDocRef);
    const currentQty = itemDoc.exists ? (itemDoc.data() as any).quantity : 0;
    newQty = parsed.action === "ADD" 
      ? currentQty + parsed.quantity 
      : Math.max(0, currentQty - parsed.quantity);
    
    transaction.set(itemDocRef, {
      name: parsed.item,
      quantity: newQty,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });

  await logsRef.add({
    action: parsed.action,
    item: parsed.item,
    quantity: parsed.quantity,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  return `${parsed.reply}\n📦 Current Total: ${newQty}`;
}

async function buildQueryReply(sender: string, parsed: ParsedAction): Promise<string> {
  const inventoryRef = db.collection("shops").doc(sender).collection("inventory");
  const snapshot = await inventoryRef.get();
  if (snapshot.empty) return parsed.reply + "\nEmpty / ఖాళీగా ఉంది / खाली है";
  
  const items = snapshot.docs.map(doc => `- ${doc.data().name}: ${doc.data().quantity}`);
  return parsed.reply + "\n" + items.join("\n");
}

async function buildReportReply(sender: string, parsed: ParsedAction): Promise<string> {
  const logsRef = db.collection("shops").doc(sender).collection("logs");
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  
  const logSnapshot = await logsRef.where("timestamp", ">=", admin.firestore.Timestamp.fromDate(startOfDay)).get();
  const summary = logSnapshot.docs.reduce((acc: any, d) => {
    const data = d.data();
    const key = `${data.action} ${data.item}`;
    acc[key] = (acc[key] || 0) + data.quantity;
    return acc;
  }, {});

  const summaryText = Object.entries(summary).map(([key, val]) => `• ${key}: ${val}`).join("\n");
  return summaryText ? `${parsed.reply}\n\n📊 Today's Activity:\n${summaryText}` : `${parsed.reply}\nNo activity today / आज कोई हलचल नहीं हुई।`;
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

async function handleInvalidParse(sender: string) {
  await sendWhatsAppMessage(
    sender,
    "Samajh nahi aaya 🙏 Try: 'add 5 chips' ya 'show inventory'"
  );
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
  } else {
    res.sendStatus(403);
  }
});

// Incoming Messages
app.post("/api/webhook/whatsapp", async (req, res) => {
  const body = req.body;
  let messageText = "";
  let sender = "";

  if (body.object === "whatsapp_business_account") {
    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (message && message.type === "text") {
      messageText = message.text.body;
      sender = message.from;
    }
  } else if (body.text) {
    messageText = body.text;
    sender = body.from || "919999999999";
  }

  if (!messageText || !sender) return res.sendStatus(200);

  console.log(`[WA RECV] ${sender}: ${messageText}`);

  // 2. Parse with Rules or AI Fallback
  let parsedAction = parseMessageRuleBased(messageText);
  let handledBy = "RULES";

  if (!parsedAction) {
    parsedAction = await parseMessageWithAI(messageText);
    handledBy = "AI";
  }

  console.log(`[PARSE] Handled by: ${handledBy}`);

  if (!isValidParsedAction(parsedAction)) {
    console.error(`[PARSE ERROR] Invalid action received from ${handledBy}:`, parsedAction);
    await handleInvalidParse(sender);
    return res.sendStatus(200);
  }

  let finalReply = "";

  try {
    // 3. Process the validated action
    if (parsedAction.action === "ADD" || parsedAction.action === "SELL") {
      finalReply = await processAddSell(sender, parsedAction);
    } else if (parsedAction.action === "QUERY") {
      finalReply = await buildQueryReply(sender, parsedAction);
    } else if (parsedAction.action === "REPORT") {
      finalReply = await buildReportReply(sender, parsedAction);
    }

    // 4. Reply via WhatsApp
    await sendWhatsAppMessage(sender, finalReply);

  } catch (error) {
    console.error("[PROCESS ERROR]", error);
  }

  res.status(200).json({ success: true, handledBy, result: parsedAction });
});

// Health check
app.get("/", (req, res) => res.send("Kirana AI Bot is running..."));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
