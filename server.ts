import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";
import admin from "firebase-admin";
import dotenv from "dotenv";

import { smartParse, detectLanguage, cleanItemName, capitalize, addVerbs, soldVerbs, priceWords } from "./src/parser";
import { replyTemplates, getReply, Lang } from "./src/templates";
import { 
  getUser, saveUser, updateStock, getInventory, 
  logTransaction, getTodayTransactions,
  getOnboardingState, setOnboardingState, clearOnboardingState,
  setItemPrice, getItemPrice, getPriceQueue, addToPriceQueue, shiftPriceQueue
} from "./src/database";

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "KIRANA_SECRET";
const GEMINI_KEY = process.env.GEMINI_API_KEY;

process.on("SIGTERM", () => {
  console.log("[SERVER] SIGTERM received, shutting down gracefully");
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  console.error("[SERVER] Uncaught exception:", err.message);
  // Don't crash — log and continue
});

process.on("unhandledRejection", (reason) => {
  console.error("[SERVER] Unhandled rejection:", reason);
  // Don't crash — log and continue
});

const genAI = new GoogleGenerativeAI(GEMINI_KEY || "");
const app = express();
app.use(bodyParser.json());

async function parseMessageWithAI(messageText: string): Promise<any> {
  if (!GEMINI_KEY) return null;
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  try {
    const prompt = `INSTRUCTION: Professional Kirana Inventory Manager. Return JSON with this exact structure:
    {
      "action": "add" | "sold" | "inventory" | "report" | "unknown",
      "item": "item name without unit",
      "quantity": number,
      "unit": "kg" | "ltr" | "pkt" | "pcs" | "box" | "bottle" | "" 
    }
    USER: ${messageText}`;
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

  // FIX 2: Optimized - use queue from already-fetched profile
  const priceQueue: string[] = (profile as any).pendingPriceFor || [];
  if (priceQueue.length > 0) {
    const priceMatch = messageText.match(/(\d+)/);
    const price = priceMatch ? parseInt(priceMatch[1]) : null;

    if (price !== null) {
      const itemName = await shiftPriceQueue(sender);
      if (itemName) {
        await setItemPrice(sender, itemName, price);
        await sendWhatsAppMessage(sender, reply.priceConfirmed(capitalize(itemName), price));
        
        // Check for next item in queue (re-read to get latest)
        const remaining = await getPriceQueue(sender);
        if (remaining.length > 0) {
          await sendWhatsAppMessage(sender, reply.askPrice(capitalize(remaining[0])));
        }
        return res.sendStatus(200);
      }
    } else {
      // User sent something but we need a price for the current item in queue
      await sendWhatsAppMessage(sender, reply.askPriceAgain(capitalize(priceQueue[0])));
      return res.sendStatus(200);
    }
  }

  const lines = messageText.split("\n").map(l => l.trim()).filter(Boolean);
  let results: string[] = [], isAnyAction = false, contextAction: "add" | "sold" | null = null;
  let itemsAddedToQueue = false;

  try {
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
      // Only override with sold/add verbs if the current intent is generic or already an update
      if (["unknown", "not_understood", "add", "sold"].includes(parsed.action)) {
        if (soldVerbs.some(v => lower.includes(v))) effectiveAction = "sold";
        else if (addVerbs.some(v => lower.includes(v))) effectiveAction = "add";
        else if (contextAction) effectiveAction = contextAction;
      }

      if (effectiveAction === "greeting") {
        results.push(reply.greeting(ownerName));
        isAnyAction = true;
      } 
      else if (effectiveAction === "set_price") {
        await setItemPrice(sender, parsed.item, parsed.price);
        results.push(reply.priceUpdated(capitalize(parsed.item), parsed.price));
        isAnyAction = true;
      }
      else if (effectiveAction === "low_stock") {
        const inv = await getInventory(sender);
        const lowItems = inv.filter((i: any) => i.quantity < 5).sort((a, b) => a.name.localeCompare(b.name));
        if (lowItems.length === 0) {
          results.push(reply.noLowStock(ownerName));
        } else {
          results.push(reply.lowStockHeader(ownerName));
          lowItems.forEach((i: any) => results.push(reply.lowStockItem(capitalize(i.name), i.quantity, i.unit || "")));
        }
        isAnyAction = true;
      }
      else if (["add", "sold"].includes(effectiveAction) && (parsed.item || line.match(/\d/))) {
        let item = parsed.item, qty = parsed.quantity, unit = parsed.unit || "";
        if (!item) {
          const m = line.match(/(\d+)\s*(kg|kgs|kilo|g|gm|l|ltr|ml|pkt|box|bottle|btl|pcs?|dozen|bag|roll)?\s+(.+)$/i) || line.match(/^([a-z][\w\s]+?)\s+(\d+)$/);
          if (m) { 
            qty = parseInt(m[1].match(/\d+/) ? m[1] : (m[3] ? m[3] : m[2]));
            unit = m[1].match(/\d+/) ? (m[2] || "") : "";
            item = cleanItemName(m[1].match(/\d+/) ? m[3] : m[1]); 
          }
        }
        if (item && qty) {
          const isAdd = effectiveAction === "add";
          const { newQty, finalUnit, finalItem, isMerged, itemPrice } = await updateStock(sender, item, qty, isAdd ? "ADD" : "SELL", unit);
          await logTransaction(sender, isAdd ? "ADD" : "SELL", finalItem, qty, finalUnit, itemPrice);
          
          if (isAdd && isMerged) {
            results.push(`✅ ${reply.addSuccessWithMerge(qty, finalUnit, item, capitalize(finalItem), newQty)}`);
          } else {
            const successReply = isAdd ? reply.addSuccess(qty, capitalize(finalItem), newQty, finalUnit) : reply.soldSuccess(qty, capitalize(finalItem), newQty, finalUnit);
            results.push(`✅ ${successReply}`);
          }
          
          if (!isAdd && newQty <= 5) results.push(reply.lowStock(finalItem, newQty, finalUnit));
          
          if (isAdd) {
            const existingPrice = await getItemPrice(sender, finalItem);
            if (!existingPrice) {
              await addToPriceQueue(sender, finalItem);
              itemsAddedToQueue = true;
            }
          }
          isAnyAction = true;
        }
      } 
      else if (effectiveAction === "bulk_add") {
        isAnyAction = true;
        for (const item of parsed.items) {
          const { newQty, finalUnit, finalItem } = await updateStock(sender, item.item, item.quantity, "ADD", item.unit);
          const existingPrice = await getItemPrice(sender, finalItem);
          await logTransaction(sender, "ADD", finalItem, item.quantity, finalUnit, existingPrice || 0);
          results.push(`✅ ${reply.addSuccess(item.quantity, capitalize(finalItem), newQty, finalUnit)}`);
          if (!existingPrice) {
            await addToPriceQueue(sender, finalItem);
            itemsAddedToQueue = true;
          }
        }
      }
      else if (effectiveAction === "VIEW_STOCK") {
        const inventory = await getInventory(sender);
        const lines = inventory
          .filter((item: any) => item.quantity > 0)
          .sort((a: any, b: any) => a.name.localeCompare(b.name))
          .map((item: any) => `📦 ${item.name}: ${item.quantity}${item.unit ? " " + item.unit : ""}`);

        results.push(lines.length ? lines.join("\n") : "Stock emi ledu 📭");
        isAnyAction = true;
      }
      else if (effectiveAction === "report") {
        const txs = await getTodayTransactions(sender);
        if (txs.length === 0) {
          let emptyMsg = "No transactions today yet! Start by adding stock 📦";
          if (lang === "telugu") emptyMsg = "Neti transactions emi levu! Stock add cheyandi 📦";
          else if (lang === "hindi") emptyMsg = "Aaj koi transaction nahi! Stock add karo 📦";
          results.push(emptyMsg);
          isAnyAction = true;
          continue;
        }

        const sells = txs.filter(t => t.action === "SELL");

        // Group sells by item name with mandatory current price lookup
        const sellMap: Record<string, { qty: number; revenue: number; displayName: string }> = {};
        for (const t of sells) {
          const itemKey = t.item?.toLowerCase().trim();
          if (!itemKey) continue;

          // Always look up current price from inventory for 100% accuracy
          const currentPrice = await getItemPrice(sender, itemKey);
          const revenue = currentPrice ? currentPrice * t.quantity : (t.revenue ?? 0);

          if (!sellMap[itemKey]) {
            sellMap[itemKey] = { qty: 0, revenue: 0, displayName: t.item };
          }
          sellMap[itemKey].qty += t.quantity;
          sellMap[itemKey].revenue += revenue;
        }

        const sellLines = Object.entries(sellMap).map(([, { qty, revenue, displayName }]) => {
          const revenueStr = revenue ? ` (₹${revenue})` : "";
          return `🛒 Sold ${capitalize(displayName)}: ${qty}${revenueStr}`;
        });

        const totalRevenue = Object.values(sellMap)
          .reduce((sum, { revenue }) => sum + revenue, 0);

        const reportText = sellLines.length
          ? sellLines.join("\n")
          : "Inniki emee ammaledu 🙂";

        const finalReply = 
          `Sulla anna, neti report idi:\n\n` + 
          reportText + "\n\n" + 
          `💰 Mottam aaya: ₹${totalRevenue}`;

        results.push(finalReply);
        isAnyAction = true;
      }
 else if (parsed.action !== "skip") {
        results.push(`⚠️ Artham kaaledu: "${line}"`);
      }
    }
  } catch (err: any) {
    console.error("[MULTILINE ERROR]", err.message);
    await sendWhatsAppMessage(sender, reply.notUnderstood);
  }

  if (isAnyAction && results.length > 0) {
    const meaningfulActions = results.filter(r => !r.includes("Hey") && !r.includes("Baagundi") && !r.includes("Kya haal"));
    if (meaningfulActions.length >= 2) {
      await sendWhatsAppMessage(sender, reply.bulkDone + "\n\n" + results.join("\n"));
    } else {
      await sendWhatsAppMessage(sender, results.join("\n"));
    }
  }

  // If new items were added that need prices, ask for the first one in the queue
  if (itemsAddedToQueue) {
    const currentQueue = await getPriceQueue(sender);
    if (currentQueue.length > 0) {
      await sendWhatsAppMessage(sender, reply.askPrice(capitalize(currentQueue[0])));
    }
  }

  res.status(200).json({ success: true });
});

app.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));
