import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { findFuzzyMatch } from "./parser";

dotenv.config();

// --- Initialize Firebase Admin ---
let db: admin.firestore.Firestore;

const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
const serviceAccountPath = path.resolve(process.cwd(), "service-account.json");

if (serviceAccountEnv) {
  const serviceAccount = JSON.parse(serviceAccountEnv);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} else if (fs.existsSync(serviceAccountPath)) {
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf-8"));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} else {
  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || "ai-studio-applet-webapp-51469"
  });
}

const firestoreDatabaseId = process.env.FIREBASE_FIRESTORE_DATABASE_ID || "kirana-inventory-db";
console.log(`[INIT] Connecting to Firestore Database: ${firestoreDatabaseId}`);
db = getFirestore(admin.app(), firestoreDatabaseId);

// --- Database Helper Functions ---

async function getUser(phone: string) {
  const profileRef = db.collection("shops").doc(phone).collection("profile").doc("info");
  const doc = await profileRef.get();
  return doc.exists ? doc.data() : null;
}

async function saveUser(phone: string, data: any) {
  const profileRef = db.collection("shops").doc(phone).collection("profile").doc("info");
  await profileRef.set({
    ...data,
    phone,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

async function getOnboardingState(phone: string): Promise<{step: string, shopName?: string, language?: any} | null> {
  const doc = await db.collection("onboarding").doc(phone).get();
  return doc.exists ? doc.data() as any : null;
}

async function setOnboardingState(phone: string, state: {step: string, shopName?: string, language?: any}): Promise<void> {
  await db.collection("onboarding").doc(phone).set(state);
}

async function clearOnboardingState(phone: string): Promise<void> {
  await db.collection("onboarding").doc(phone).delete();
}

async function updateStock(phone: string, item: string, quantity: number, action: "ADD" | "SELL", unit: string = "") {
  const inventorySnapshot = await db.collection("shops").doc(phone).collection("inventory").get();
  const existingDocs = inventorySnapshot.docs.map(d => ({ name: (d.data() as any).name, key: d.id }));
  
  const fuzzyMatch = findFuzzyMatch(item, existingDocs.map(d => d.name));
  let finalItem = item;
  let isMerged = false;
  if (fuzzyMatch && fuzzyMatch.toLowerCase() !== item.toLowerCase()) {
    console.log(`[FUZZY] Merged "${item}" → "${fuzzyMatch}"`);
    finalItem = fuzzyMatch;
    isMerged = true;
  }

  const itemKey = finalItem.toLowerCase().trim();
  const itemDocRef = db.collection("shops").doc(phone).collection("inventory").doc(itemKey);
  
  let newQty = 0;
  let finalUnit = unit;
  let itemPrice = 0;

  await db.runTransaction(async (transaction) => {
    const itemDoc = await transaction.get(itemDocRef);
    const data = itemDoc.exists ? (itemDoc.data() as any) : null;
    const currentQty = data ? data.quantity : 0;
    itemPrice = data ? (data.price || 0) : 0;
    
    if (!finalUnit && data && data.unit) {
      finalUnit = data.unit;
    }

    newQty = action === "ADD" 
      ? currentQty + quantity 
      : Math.max(0, currentQty - quantity);
    
    transaction.set(itemDocRef, {
      name: finalItem,
      quantity: newQty,
      unit: finalUnit,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
  return { newQty, finalUnit, finalItem, isMerged, itemPrice };
}

async function setItemPrice(phone: string, item: string, price: number): Promise<void> {
  const itemKey = item.toLowerCase().trim();
  await db.collection("shops").doc(phone).collection("inventory").doc(itemKey).set({
    price: price,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

async function getItemPrice(phone: string, item: string): Promise<number | null> {
  const itemKey = item.toLowerCase().trim();
  const doc = await db.collection("shops").doc(phone).collection("inventory").doc(itemKey).get();
  return doc.exists ? (doc.data() as any).price || null : null;
}

async function getPriceQueue(phone: string): Promise<string[]> {
  const doc = await db.collection("shops").doc(phone).collection("profile").doc("info").get();
  return doc.exists ? (doc.data() as any).pendingPriceFor || [] : [];
}

async function addToPriceQueue(phone: string, itemName: string): Promise<void> {
  await db.collection("shops").doc(phone).collection("profile").doc("info").set({
    pendingPriceFor: admin.firestore.FieldValue.arrayUnion(itemName)
  }, { merge: true });
}

async function shiftPriceQueue(phone: string): Promise<string | null> {
  const docRef = db.collection("shops").doc(phone).collection("profile").doc("info");
  const doc = await docRef.get();
  if (!doc.exists) return null;
  
  const queue = (doc.data() as any).pendingPriceFor || [];
  if (queue.length === 0) return null;
  
  const shifted = queue[0];
  const newQueue = queue.slice(1);
  
  if (newQueue.length === 0) {
    await docRef.update({ pendingPriceFor: admin.firestore.FieldValue.delete() });
  } else {
    await docRef.update({ pendingPriceFor: newQueue });
  }
  
  return shifted;
}

async function getInventory(phone: string) {
  const snapshot = await db.collection("shops").doc(phone).collection("inventory").get();
  return snapshot.docs.map(doc => doc.data());
}

async function logTransaction(phone: string, action: string, item: string, quantity: number, unit: string = "", price: number = 0) {
  const logsRef = db.collection("shops").doc(phone).collection("logs");
  await logsRef.add({
    action,
    item,
    quantity,
    unit,
    price,
    revenue: action === "SELL" ? (quantity * price) : 0,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });
}

async function getTodayTransactions(phone: string) {
  const logsRef = db.collection("shops").doc(phone).collection("logs");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTimestamp = admin.firestore.Timestamp.fromDate(today);

  const snapshot = await logsRef
    .where("timestamp", ">=", todayTimestamp)
    .orderBy("timestamp", "asc")
    .get();
    
  return snapshot.docs.map(doc => doc.data());
}

export { 
  db, 
  getUser, 
  saveUser, 
  getOnboardingState,
  setOnboardingState,
  clearOnboardingState,
  updateStock, 
  setItemPrice,
  getItemPrice,
  getPriceQueue,
  addToPriceQueue,
  shiftPriceQueue,
  getInventory, 
  logTransaction, 
  getTodayTransactions 
};



