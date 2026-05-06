import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";
import admin from "firebase-admin";
import dotenv from "dotenv";

import { smartParse, detectLanguage, cleanItemName, capitalize, addVerbs, soldVerbs } from "./src/parser";
import { replyTemplates, getReply, Lang } from "./src/templates";
import { 
  getUser, saveUser, updateStock, getInventory, 
  logTransaction, getTodayTransactions,
  getOnboardingState, setOnboardingState, clearOnboardingState
} from "./src/database";

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "KIRANA_SECRET";
const GEMINI_KEY = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(GEMINI_KEY || "");
const app = express();
app.use(bodyParser.json());

async function parseMessageWithAI(messageText: string): Promise<any> {
  if (!GEMINI_KEY) return null;
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  try {
    const prompt = `INSTRUCTION: Professional Kirana Inventory Manager. Extract action (ADD/SELL/QUERY/REPORT), item, quantity. Return JSON. USER: ${messageText}`;
    const result = await model.generateContent({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } });
    return JSON.parse(result.response.text().trim());
  } catch { return null; }
}

async function parseMessage(message: string): Promise<any> {
  const ruleResult = smartParse(message);
  if (ruleResult.action !== "unknown") return ruleResult;
  try {
    const aiResult = await parseMessageWithAI(message);
    if (aiResult?.action) return { ...aiResult, action: aiResult.action.toLowerCase() };
  } catch (err) { console.log("[FALLBACK] Gemini unavailable"); }
  return { action: "not_understood" };
}

async function sendWhatsAppMessage(to: string, text: string) {
  if (!WHATSAPP_TOKEN || !PHONE_ID) return;
  try {
    await axios.post(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
      messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text },
    }, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } });
    console.log(`[WA] Sent to ${to}: ${text.substring(0, 50)}...`);
  } catch (error: any) { console.error("[WA ERROR]", error.response?.data || error.message); }
}

app.get("/api/webhook/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"], token = req.query["hub.verify_token"], challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) res.status(200).send(challenge);
  else res.sendStatus(403);
});

app.post("/api/webhook/whatsapp", async (req, res) => {
  const body = req.body;
  let messageText = "", sender = "";
  if (body.object === "whatsapp_business_account") {
    const msg = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (msg?.type === "text") { messageText = msg.text.body; sender = msg.from; }
  } else if (body.text) { messageText = body.text; sender = body.from || "919999999999"; }

  if (!messageText || !sender) return res.sendStatus(200);
  console.log(`[WA RECV] ${sender}: ${messageText}`);

  const profile = await getUser(sender);
  if (!profile) {
    const onboarding = await getOnboardingState(sender);
    if (!onboarding) {
      const lang = detectLanguage(messageText);
      await setOnboardingState(sender, { step: "awaiting_shop_name", language: lang });
      await sendWhatsAppMessage(sender, getReply(lang).askShopName);
    } else if (onboarding.step === "awaiting_shop_name") {
      const shopName = messageText.trim();
      await setOnboardingState(sender, { ...onboarding, step: "awaiting_owner_name", shopName });
      await sendWhatsAppMessage(sender, getReply(onboarding.language!).shopRegistered(shopName));
    } else {
      const { shopName, language } = onboarding;
      await saveUser(sender, { shopName, ownerName: messageText, language });
      await clearOnboardingState(sender);
      await sendWhatsAppMessage(sender, getReply(language!).welcomeUser(messageText, shopName!));
    }
    return res.sendStatus(200);
  }

  let lang = (profile.language as Lang) || "english";
  const newLang = detectLanguage(messageText);
  if ((newLang === "telugu" || newLang === "hindi") && newLang !== lang) {
    lang = newLang;
    await saveUser(sender, { language: lang });
  }

  const reply = getReply(lang), ownerName = (profile.ownerName || "Owner").split(" ")[0];
  const lines = messageText.split("\n").filter(l => l.trim() !== "");
  let results: string[] = [], isAnyAction = false, contextAction: "add" | "sold" | null = null;

  for (const line of lines) {
    const parsed = await parseMessage(line);
    console.log("[PARSE]", line, "->", parsed.action);
    if (parsed.action === "skip") {
      const lower = line.toLowerCase();
      if (lower.includes("sold")) contextAction = "sold";
      else if (lower.includes("add")) contextAction = "add";
      continue;
    }
    
    let effectiveAction = parsed.action;
    const lower = line.toLowerCase();
    if (soldVerbs.some(v => lower.includes(v))) effectiveAction = "sold";
    else if (addVerbs.some(v => lower.includes(v))) effectiveAction = "add";
    else if (contextAction && ["add", "sold", "unknown", "not_understood"].includes(parsed.action)) effectiveAction = contextAction;

    if (effectiveAction === "greeting") {
      results.push(reply.greeting(ownerName));
      isAnyAction = true;
    } else if (["add", "sold"].includes(effectiveAction) && (parsed.item || line.match(/\d/))) {
      let item = parsed.item, qty = parsed.quantity, unit = parsed.unit || "";
      if (!item) {
        const m = line.match(/^(\d+)\s*(kg|kgs|kilo|g|gm|l|ltr|ml|pkt|box|bottle|btl|pcs?|dozen|bag|roll)?\s+(.+)$/i) || line.match(/^([a-z][\w\s]+?)\s+(\d+)$/);
        if (m) { 
          qty = parseInt(m[1].match(/\d+/) ? m[1] : (m[3] ? m[3] : m[2]));
          unit = m[1].match(/\d+/) ? (m[2] || "") : "";
          item = cleanItemName(m[1].match(/\d+/) ? m[3] : m[1]); 
        }
      }
      if (item && qty) {
        const isAdd = effectiveAction === "add";
        const { newQty, finalUnit, finalItem } = await updateStock(sender, item, qty, isAdd ? "ADD" : "SELL", unit);
        await logTransaction(sender, isAdd ? "ADD" : "SELL", finalItem, qty, finalUnit);
        
        const successReply = isAdd ? reply.addSuccess(qty, capitalize(finalItem), newQty, finalUnit) : reply.soldSuccess(qty, capitalize(finalItem), newQty, finalUnit);
        results.push(`✅ ${successReply}`);
        
        if (!isAdd && newQty <= 5) results.push(reply.lowStock(finalItem, newQty, finalUnit));
        isAnyAction = true;
      }
    } else if (effectiveAction === "inventory") {
      const inv = await getInventory(sender);
      const list = inv.map((i: any) => `- ${capitalize(i.name)}: ${i.quantity} ${i.unit || ""}`.trim()).sort().join("\n");
      results.push(reply.inventoryHeader(ownerName) + "\n" + (list || "Empty"));
      isAnyAction = true;
    } else if (effectiveAction === "report") {
      const logs = await getTodayTransactions(sender);
      const summary = logs.reduce((acc: any, l: any) => {
        const k = `${l.action === "ADD" ? "Stocked" : "Sold"} ${capitalize(l.item)}`;
        acc[k] = (acc[k] || { qty: 0, unit: l.unit || "" });
        acc[k].qty += l.quantity;
        return acc;
      }, {});
      const text = Object.entries(summary).map(([k, v]: [string, any]) => `• ${k}: ${v.qty} ${v.unit}`.trim()).join("\n");
      results.push(reply.reportHeader(ownerName) + "\n" + (text || "No activity"));
      isAnyAction = true;
    } else if (parsed.action !== "skip") {
      results.push(`⚠️ Artham kaaledu: "${line}"`);
    }
  }

  if (isAnyAction && results.length > 0) {
    await sendWhatsAppMessage(sender, (reply as any).bulkDone + "\n\n" + results.join("\n"));
  }
  res.status(200).json({ success: true });
});

app.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));

