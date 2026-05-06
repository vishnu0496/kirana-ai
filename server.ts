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
const pendingOnboarding: Record<string, { step: "awaiting_shop_name" | "awaiting_owner_name"; shopName?: string; language?: Lang }> = {};

const replyTemplates = {
  english: {
    askShopName: "Welcome to Kirana AI! 👋\nWhat is your shop name?",
    shopRegistered: (shop: string) =>
      `Great! ${shop} registered ✅\nWhat is your name?`,
    welcomeUser: (name: string, shop: string) =>
      `Welcome ${name}! 🎉\n${shop} is ready on Kirana AI.\n\nTry these:\n• add 10 soaps\n• sold 5 chips\n• show inventory\n• today report`,
    addSuccess: (qty: number, item: string, total: number) =>
      `Added ${qty} ${item}! 📦 Total stock: ${total}`,
    soldSuccess: (qty: number, item: string, remaining: number) =>
      `Sold ${qty} ${item}! 🛒 Remaining: ${remaining}`,
    lowStock: (item: string, remaining: number) =>
      `⚠️ Low stock: ${item} only ${remaining} left — reorder soon!`,
    outOfStock: (item: string) =>
      `❌ ${item} is out of stock. Please restock first.`,
    bulkAddSuccess: (lines: string) => 
      `Stock updated! 📦\n${lines}`,
    inventoryHeader: (name: string) =>
      `${name}, here is your inventory:`,
    reportHeader: (name: string) =>
      `${name}, here is today's report:`,
    greeting: (name: string) =>
      `Hey ${name}! 👋 How can I help?\nTry: 'add 10 soaps' or 'show inventory'`,
    notUnderstood:
      "Didn't understand 🙏 Try: 'add 5 chips' or 'show inventory'",
  },
  telugu: {
    askShopName:
      "Kirana AI ki swaagatam! 👋\nMee shop peru cheppagalaru?",
    shopRegistered: (shop: string) =>
      `Baagundi! ${shop} register ayyindi ✅\nMee peru cheppandi?`,
    welcomeUser: (name: string, shop: string) =>
      `Swaagatam ${name} anna! 🎉\n${shop} Kirana AI lo ready ga undi.\n\nIvi try cheyyandi:\n• add 10 soaps\n• sold 5 chips\n• show inventory\n• today report`,
    addSuccess: (qty: number, item: string, total: number) =>
      `${qty} ${item} add chesamu! 📦 Meeru unna stock: ${total}`,
    soldSuccess: (qty: number, item: string, remaining: number) =>
      `${qty} ${item} ammamu! 🛒 Migilina stock: ${remaining}`,
    lowStock: (item: string, remaining: number) =>
      `⚠️ Stock takkuva: ${item} kevalam ${remaining} undhi — tvaraga order ivvandi!`,
    outOfStock: (item: string) =>
      `❌ ${item} stock ledu. Mundu restock cheyyandi.`,
    bulkAddSuccess: (lines: string) => 
      `Stock updated! 📦\n${lines}`,
    inventoryHeader: (name: string) =>
      `${name} anna, mee inventory idi:`,
    reportHeader: (name: string) =>
      `${name} anna, neti report idi:`,
    greeting: (name: string) =>
      `Baagundi ${name} anna! 👋 Ela help cheyyali?\nTry: 'add 10 soaps' or 'show inventory'`,
    notUnderstood:
      "Artham kaaledu 🙏 Try: 'add 5 chips' or 'show inventory'",
  },
  hindi: {
    askShopName:
      "Kirana AI mein swagat! 👋\nApka shop ka naam kya hai?",
    shopRegistered: (shop: string) =>
      `Badhiya! ${shop} register ho gaya ✅\nApka naam batayein?`,
    welcomeUser: (name: string, shop: string) =>
      `Swagat hai ${name} bhai! 🎉\n${shop} Kirana AI pe ready hai.\n\nYe try karein:\n• add 10 soaps\n• sold 5 chips\n• show inventory\n• today report`,
    addSuccess: (qty: number, item: string, total: number) =>
      `${qty} ${item} add ho gaya! 📦 Total stock: ${total}`,
    soldSuccess: (qty: number, item: string, remaining: number) =>
      `${qty} ${item} bik gaya! 🛒 Bacha hua: ${remaining}`,
    lowStock: (item: string, remaining: number) =>
      `⚠️ Stock kam: ${item} sirf ${remaining} bacha — jaldi order karo!`,
    outOfStock: (item: string) =>
      `❌ ${item} khatam ho gaya. Pehle restock karo.`,
    bulkAddSuccess: (lines: string) => 
      `Stock updated! 📦\n${lines}`,
    inventoryHeader: (name: string) =>
      `${name} bhai, aapki inventory:`,
    reportHeader: (name: string) =>
      `${name} bhai, aaj ki report:`,
    greeting: (name: string) =>
      `Kya haal hai ${name} bhai! 👋 Kya help chahiye?\nTry: 'add 10 soaps' ya 'show inventory'`,
    notUnderstood:
      "Samajh nahi aaya 🙏 Try: 'add 5 chips' ya 'show inventory'",
  },
};

type Lang = "english" | "telugu" | "hindi";

function getReply(lang: string) {
  return replyTemplates[(lang as Lang)] ?? replyTemplates.english;
}

function detectLanguage(message: string): Lang {
  const msg = message.toLowerCase();
  if (
    /namaskaram|vachayi|anna|ayya|bagundi|cheppu|meeru|ledhu|undi|ela|swaagatam|namasthe/.test(msg)
  )
    return "telugu";
  if (
    /namaste|bhai|kya|nahi|acha|theek|shukriya|bolo|accha|swagat|dhanyavaad/.test(msg)
  )
    return "hindi";
  return "english";
}

// ── RESEARCHED WORD LISTS ──────────────────────────────────

const greetingWords = [
  // English
  "hi","hello","hey","hii","helo","sup","yo","howdy","wassup","whatsup",
  "good morning","good evening","good afternoon","gm","ge","ga",
  // Telugu
  "namaskaram","namasthe","namaskar","ayya","anna","bava",
  "em chestunnaru","bagunnara","bagunnava","em visheshalu","enti",
  // Hindi
  "namaste","namaskar","namastey","bhai","yaar","boss",
  "kya haal","kaise ho","kya chal raha","sab theek","kya baat"
];

const addVerbs = [
  // English
  "add","added","adding","stock","restock","restocked","restocking",
  "received","receive","got","get","came","come","brought","bring",
  "purchase","purchased","buying","bought","arrived","arrive",
  "loaded","load","filled","fill","inward","new stock","new batch",
  // Telugu (Tenglish)
  "vachayi","vachindi","vachenu","tesukuvachha","tecchaanu",
  "pettandi","veyyandi","veyyi","konugoolu","konukonaamu","konnaamu",
  "stoku","nilava","sarukulu","vachhayi","tecchaaru","load chesaamu",
  // Hindi (Hinglish)
  "aaya","aayi","aaye","mila","mili","mile","laya","layi","laye",
  "mangaya","mangayi","purchase kiya","kharida","kharidi",
  "rakho","rakha","daalo","daala","bharo","bhara",
  "stock karo","stock kiya","aaya maal","maal aaya","naya maal","aa gaya"
];

const soldVerbs = [
  // English
  "sold","sell","selling","gone","went","finished","finish",
  "out","gave","give","dispatched","dispatch",
  "issued","issue","billed","bill","delivered","deliver",
  "customer took","customer bought",
  // Telugu (Tenglish)
  "ammamu","ammindi","ammaru","ammaanu","ammadam","ammakaalu",
  "ammina","ammanauten","ammutundi","iyyandi","ichhaamu","icchaanu",
  "poyindi","ayipoyindi","ayipoyayi","teesindi","teesukunnaru",
  "vikkindi","vikrayam",
  // Hindi (Hinglish)
  "becha","bechi","beche","bika","biki","bike",
  "gaya","gayi","gaye","nikla","nikli","nikle",
  "khatam","khatam hua","diya","diye","di","de diya",
  "nikal gaya","bikri","bikayi","kharch hua",
  "customer ko diya","sale hua","sell kiya","bech diya"
];

const inventoryWords = [
  // English
  "inventory","show inventory","stock list","show stock",
  "show list","check stock","how much","how many",
  "what do i have","balance","remaining","total","stock","list",
  // Telugu (Tenglish)
  "inventory chupandi","stock chupandi","nilava cheppandi",
  "nilava","emunnayi","em undi","chupandi","sarukulu chupandi",
  "meeru stock","enni unnai","enni undi","list cheppu","cheppandi",
  "entha undi","entha unnai","enti undi","stock entha","entha stoku",
  "chupandi","meeru","nilava undi",
  // Hindi (Hinglish)
  "inventory dikao","stock dikao","list dikao",
  "kya hai","kitna hai","kitna bacha","kya bacha",
  "maal dikao","sab dikao","hisaab","stock batao",
  "poora stock","kitna maal"
];

const reportWords = [
  // English
  "report","today report","daily report","sales report",
  "summary","today summary","today sales","today total",
  "earnings","income today",
  // Telugu (Tenglish)
  "report chupandi","neti report","neti summary",
  "neti ammakaalu","neti sales","neti total",
  "ee roju","ee roju report","ee roju sales",
  "mottam","mottam cheppu",
  // Hindi (Hinglish)
  "aaj ka report","aaj ki report","aaj ka summary",
  "aaj kitna bika","aaj ki bikri","aaj ka total",
  "din ka report","sales batao","kitna kamaya","aaj ka hisaab"
];

// ── BUG 1 FIX: Strip verbs from item name ──────────────────

function cleanItemName(raw: string): string {
  const allVerbs = [...addVerbs, ...soldVerbs];
  let cleaned = raw.trim();
  for (const verb of allVerbs) {
    // Remove verb if it appears at start or end of item name
    const re = new RegExp(`^${verb}\\s+|\\s+${verb}$|^${verb}$`, "i");
    cleaned = cleaned.replace(re, "").trim();
  }
  return cleaned;
}

// ── SMART PARSER ───────────────────────────────────────────

function smartParse(message: string): any {
  const msg = message.toLowerCase().trim();

  // 1. GREETING — exact match from list
  if (greetingWords.some(w => msg === w || msg.startsWith(w + " ")))
    return { action: "greeting" };

  // 2. INVENTORY — BUG 2 FIX: handle standalone stock/list
  if (msg === "stock" || msg === "list" || inventoryWords.some(w => msg.includes(w)))
    return { action: "inventory" };

  // 3. REPORT — check before number-based parsing
  if (reportWords.some(w => msg.includes(w)))
    return { action: "report" };

  // 4. BULK ADD — "add 10 soaps 5 chips 3 oil" (must come before single add)
  const bulkPairs = [...msg.matchAll(/(\d+)\s+([a-z]+)/g)];
  if (msg.startsWith("add") && bulkPairs.length >= 2) {
    return {
      action: "bulk_add",
      items: bulkPairs.map(p => ({
        quantity: parseInt(p[1]),
        item: cleanItemName(p[2])
      }))
    };
  }

  // 5. FIND NUMBER + ITEM in message (core of natural language parsing)
  const numMatch = msg.match(/(\d+)\s*([a-z]+(?:\s[a-z]+)?)/);
  if (numMatch) {
    const qty = parseInt(numMatch[1]);
    const item = cleanItemName(numMatch[2]);
    // Check if any sold verb exists in the message
    const isSold = soldVerbs.some(v => msg.includes(v));
    if (isSold) return { action: "sold", quantity: qty, item };
    // Default to add — "10 soapulu" or "5 chips vachayi" both mean add
    return { action: "add", quantity: qty, item };
  }

  return { action: "unknown" };
}

async function parseMessage(message: string): Promise<any> {
  // Step 1: Try smart-parser first — NO Gemini
  const ruleResult = smartParse(message);
  if (ruleResult.action !== "unknown") return ruleResult;

  // Step 2: Only call Gemini for ambiguous messages
  try {
    const geminiResult = await parseMessageWithAI(message);
    if (geminiResult?.action) {
      // Normalize AI action to lowercase for internal consistency
      return {
        ...geminiResult,
        action: geminiResult.action.toLowerCase()
      };
    }
  } catch (err: any) {
    // Silently handle 429 / quota errors — do not crash
    console.log("[FALLBACK] Gemini unavailable:", err?.status ?? err?.message);
  }

  // Step 3: Still unknown — return not_understood
  return { action: "not_understood" };
}

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

// --- Core Logic: Parser Validation ---
interface ParsedAction {
  action: "ADD" | "SELL" | "QUERY" | "REPORT";
  item: string;
  quantity: number;
  reply: string;
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
    const lang = onboarding.language || "english";
    const reply = getReply(lang);

    if (onboarding.step === "awaiting_shop_name") {
      const shopName = messageText.trim();
      pendingOnboarding[sender] = { ...onboarding, step: "awaiting_owner_name", shopName };
      await sendWhatsAppMessage(sender, reply.shopRegistered(shopName));
      return res.sendStatus(200);
    } else if (onboarding.step === "awaiting_owner_name") {
      const ownerName = messageText.trim();
      const shopName = onboarding.shopName || "My Shop";
      
      // Save to Firestore
      await db.collection("shops").doc(sender).collection("profile").doc("info").set({
        shopName,
        ownerName,
        language: lang,
        phone: sender,
        registeredAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      delete pendingOnboarding[sender];
      await sendWhatsAppMessage(sender, reply.welcomeUser(ownerName, shopName));
      return res.sendStatus(200);
    }
  }

  // Check if profile exists
  const profileRef = db.collection("shops").doc(sender).collection("profile").doc("info");
  const profileDoc = await profileRef.get();

  if (!profileDoc.exists) {
    // Detect language from the very first message
    const detectedLang = detectLanguage(messageText);
    pendingOnboarding[sender] = { step: "awaiting_shop_name", language: detectedLang };
    await sendWhatsAppMessage(sender, getReply(detectedLang).askShopName);
    return res.sendStatus(200);
  }

  const profileData = profileDoc.data();
  let lang = (profileData?.language as Lang) || "english";

  // BUG 1 FIX: Language update for existing users
  const newDetectedLang = detectLanguage(messageText);
  if ((newDetectedLang === "telugu" || newDetectedLang === "hindi") && newDetectedLang !== lang) {
    lang = newDetectedLang;
    await profileRef.update({ language: lang });
    console.log(`[LANG SWITCH] ${sender} switched to ${lang}`);
  }

  const ownerName = profileData?.ownerName || "Owner";
  const ownerFirstName = ownerName.split(" ")[0];
  const reply = getReply(lang);

  // 2. PARSE MESSAGE (Rule-Based First, Gemini Fallback)
  const actionResult = await parseMessage(messageText);
  console.log(`[PARSE] Action: ${actionResult.action}`);

  let finalReply = "";

  try {
    if (actionResult.action === "greeting") {
      finalReply = reply.greeting(ownerFirstName);
    } 
    else if (actionResult.action === "add" || actionResult.action === "sold") {
      const isAdd = actionResult.action === "add";
      // Construct a temporary ParsedAction for processAddSell compatibility
      const tempAction: ParsedAction = {
        action: isAdd ? "ADD" : "SELL",
        item: actionResult.item,
        quantity: actionResult.quantity,
        reply: "" // reply is generated by getReply now
      };

      await processAddSell(sender, tempAction);
      
      // Fetch new quantity for the accurate reply
      const itemDoc = await db.collection("shops").doc(sender).collection("inventory").doc(actionResult.item.toLowerCase().trim()).get();
      const currentQty = itemDoc.exists ? (itemDoc.data() as any).quantity : 0;
      
      finalReply = isAdd 
        ? reply.addSuccess(actionResult.quantity, actionResult.item, currentQty)
        : reply.soldSuccess(actionResult.quantity, actionResult.item, currentQty);

      // BUG 4 FIX: Low stock alert only for sold actions
      if (!isAdd && currentQty <= 5) {
        finalReply += "\n\n" + reply.lowStock(actionResult.item, currentQty);
      }
    } 
    else if (actionResult.action === "bulk_add" || actionResult.action === "bulk_sold") {
      const isAdd = actionResult.action === "bulk_add";
      let summaryLines: string[] = [];
      let lowStockAlerts: string[] = [];

      for (const item of actionResult.items) {
        const tempAction: ParsedAction = {
          action: isAdd ? "ADD" : "SELL",
          item: item.item,
          quantity: item.quantity,
          reply: ""
        };
        await processAddSell(sender, tempAction);
        
        const itemDoc = await db.collection("shops").doc(sender).collection("inventory").doc(item.item.toLowerCase().trim()).get();
        const currentQty = itemDoc.exists ? (itemDoc.data() as any).quantity : 0;
        
        // BUG 3 FIX: Bulk add reply message format
        summaryLines.push(`• ${item.quantity} ${item.item} added (total: ${currentQty})`);
        
        // BUG 4 FIX: Low stock alert only for bulk_sold
        if (!isAdd && currentQty <= 5) {
          lowStockAlerts.push(reply.lowStock(item.item, currentQty));
        }
      }

      if (isAdd) {
        finalReply = (reply as any).bulkAddSuccess(summaryLines.join("\n"));
      } else {
        finalReply = `📊 End of day update done, ${ownerFirstName} bhai!\n` + summaryLines.join("\n").replace(/added/g, "sold");
      }

      if (lowStockAlerts.length > 0) {
        finalReply += "\n\n⚠️ Low stock alert:\n" + lowStockAlerts.join("\n");
      }
    } 
    else if (actionResult.action === "inventory") {
      const inventoryRef = db.collection("shops").doc(sender).collection("inventory");
      const snapshot = await inventoryRef.get();
      if (snapshot.empty) {
        finalReply = reply.inventoryHeader(ownerFirstName) + "\nEmpty / ఖాళీగా ఉంది / खाली है";
      } else {
        const items = snapshot.docs.map(doc => `- ${doc.data().name}: ${doc.data().quantity}`);
        finalReply = reply.inventoryHeader(ownerFirstName) + "\n" + items.join("\n");
      }
    } 
    else if (actionResult.action === "report") {
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
      finalReply = reply.reportHeader(ownerFirstName) + "\n" + (summaryText || "No activity today.");
    } 
    else {
      finalReply = reply.notUnderstood;
    }

    // 4. Reply via WhatsApp
    await sendWhatsAppMessage(sender, finalReply);

  } catch (error) {
    console.error("[PROCESS ERROR]", error);
  }

  res.status(200).json({ success: true, action: actionResult.action });
});

// Health check
app.get("/", (req, res) => res.send("Kirana AI Bot is running..."));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
