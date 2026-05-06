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
const PORT = Number(process.env.PORT) || 3000;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "KIRANA_SECRET";
const GEMINI_KEY = process.env.GEMINI_API_KEY;

// --- Global State (In-Memory) ---
const pendingOnboarding: Record<string, { step: "awaiting_shop_name" | "awaiting_owner_name"; shopName?: string }> = {};

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

function parseBulkAction(messageText: string): ParsedAction[] | null {
  const text = messageText.toLowerCase().trim();
  const bulkMatch = text.match(/^(sold|becha|add)\s+(.+)$/i);
  if (!bulkMatch) return null;

  const actionType = bulkMatch[1].toLowerCase() === "add" ? "ADD" : "SELL";
  const content = bulkMatch[2];
  
  // Regex to find all "quantity item" pairs
  const itemRegex = /(\d+)\s+([^0-9]+?)(?=\s+\d+|$)/g;
  const matches = [...content.matchAll(itemRegex)];
  
  if (matches.length <= 1 && actionType === "SELL") {
    // If only one item, let the normal rule-based or AI parser handle it
    // unless it was specifically triggered by "becha"
    if (bulkMatch[1].toLowerCase() !== "becha") return null;
  }
  
  if (matches.length === 0) return null;

  return matches.map(m => ({
    action: actionType,
    quantity: parseInt(m[1], 10),
    item: m[2].trim(),
    reply: actionType === "ADD" ? `Added ${m[1]} ${m[2].trim()}` : `Sold ${m[1]} ${m[2].trim()}`
  }));
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

  // 1. FIRST TIME ONBOARDING LOGIC
  const onboarding = pendingOnboarding[sender];
  if (onboarding) {
    if (onboarding.step === "awaiting_shop_name") {
      const shopName = messageText.trim();
      pendingOnboarding[sender] = { step: "awaiting_owner_name", shopName };
      await sendWhatsAppMessage(sender, `Great! ${shopName} registered ✅\nAb apka naam batayein? (Your name please?)`);
      return res.sendStatus(200);
    } else if (onboarding.step === "awaiting_owner_name") {
      const ownerName = messageText.trim();
      const shopName = onboarding.shopName;
      
      // Save to Firestore
      await db.collection("shops").doc(sender).collection("profile").doc("info").set({
        shopName,
        ownerName,
        phone: sender,
        registeredAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      delete pendingOnboarding[sender];
      
      await sendWhatsAppMessage(sender, 
        `Welcome ${ownerName} bhai! 🎉\n${shopName} is ready on Kirana AI.\n\nTry these commands:\n• add 10 soaps\n• sold 5 chips\n• show inventory\n• today report`
      );
      return res.sendStatus(200);
    }
  }

  // Check if profile exists
  const profileRef = db.collection("shops").doc(sender).collection("profile").doc("info");
  const profileDoc = await profileRef.get();

  if (!profileDoc.exists) {
    pendingOnboarding[sender] = { step: "awaiting_shop_name" };
    await sendWhatsAppMessage(sender, "Namaste! 🙏 Welcome to Kirana AI!\nApka shop ka naam kya hai?\n(What is your shop name?)");
    return res.sendStatus(200);
  }

  const profileData = profileDoc.data();
  const ownerFirstName = profileData?.ownerName?.split(" ")[0] || "Owner";

  // 2. BULK PROCESSING
  const bulkActions = parseBulkAction(messageText);
  if (bulkActions && bulkActions.length > 1) {
    let summaryLines = [`📊 ${bulkActions[0].action === "ADD" ? "Bulk stock update" : "End of day update"} done, ${ownerFirstName} bhai!`];
    let lowStockAlerts: string[] = [];

    for (const action of bulkActions) {
      await processAddSell(sender, action);
      
      // Fetch new quantity for the summary and low stock check
      const itemDoc = await db.collection("shops").doc(sender).collection("inventory").doc(action.item.toLowerCase().trim()).get();
      const currentQty = itemDoc.exists ? (itemDoc.data() as any).quantity : 0;
      
      summaryLines.push(`• ${action.action === "ADD" ? "Added" : "Sold"} ${action.item}: ${action.quantity} (remaining: ${currentQty})`);
      
      if (currentQty <= 5) {
        lowStockAlerts.push(` • ${action.item} only ${currentQty} left — time to reorder!`);
      }
    }

    let finalBulkReply = summaryLines.join("\n");
    if (lowStockAlerts.length > 0) {
      finalBulkReply += "\n\n⚠️ Low stock alert:\n" + lowStockAlerts.join("\n");
    }

    await sendWhatsAppMessage(sender, finalBulkReply);
    return res.sendStatus(200);
  }

  // 3. NORMAL PROCESSING (Rules or AI Fallback)
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
      
      // Add personalization to the string returned by processAddSell
      // Pattern: "Sold 5 chips\n📦 Current Total: X" -> "Sold 5 chips, Ramesh bhai!\n📦 Current Total: X"
      finalReply = finalReply.replace("\n📦 Current Total:", `, ${ownerFirstName} bhai!\n📦 Current Total:`);

      // Check Low Stock
      const itemDoc = await db.collection("shops").doc(sender).collection("inventory").doc(parsedAction.item.toLowerCase().trim()).get();
      const currentQty = itemDoc.exists ? (itemDoc.data() as any).quantity : 0;
      if (currentQty <= 5) {
        finalReply += `\n\n⚠️ Low stock alert:\n • ${parsedAction.item} only ${currentQty} left — time to reorder!`;
      }

    } else if (parsedAction.action === "QUERY") {
      finalReply = await buildQueryReply(sender, parsedAction);
      // Prepend personalization
      finalReply = `${ownerFirstName} bhai, ` + finalReply.charAt(0).toLowerCase() + finalReply.slice(1);
    } else if (parsedAction.action === "REPORT") {
      finalReply = await buildReportReply(sender, parsedAction);
      // Personalize
      finalReply = `${ownerFirstName} bhai, here is today's report:\n` + finalReply.split("\n").slice(1).join("\n");
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
