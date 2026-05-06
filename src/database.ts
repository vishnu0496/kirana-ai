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
  const existingItems = inventorySnapshot.docs.map(d => (d.data() as any).name);
  
  const fuzzyMatch = findFuzzyMatch(item, existingItems);
  let finalItem = item;
  if (fuzzyMatch && fuzzyMatch.toLowerCase() !== item.toLowerCase()) {
    console.log(`[FUZZY] Merged "${item}" → "${fuzzyMatch}"`);
    finalItem = fuzzyMatch;
  }

  const itemKey = finalItem.toLowerCase().trim();
  const itemDocRef = db.collection("shops").doc(phone).collection("inventory").doc(itemKey);
  
  let newQty = 0;
  let finalUnit = unit;

  await db.runTransaction(async (transaction) => {
    const itemDoc = await transaction.get(itemDocRef);
    const data = itemDoc.exists ? (itemDoc.data() as any) : null;
    const currentQty = data ? data.quantity : 0;
    
    // If no unit provided, try to use existing unit
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
  return { newQty, finalUnit, finalItem };
}

async function getInventory(phone: string) {
  const snapshot = await db.collection("shops").doc(phone).collection("inventory").get();
  return snapshot.docs.map(doc => doc.data());
}

async function logTransaction(phone: string, action: string, item: string, quantity: number, unit: string = "") {
  const logsRef = db.collection("shops").doc(phone).collection("logs");
  await logsRef.add({
    action,
    item,
    quantity,
    unit,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });
}

async function getTodayTransactions(phone: string) {
  const logsRef = db.collection("shops").doc(phone).collection("logs");
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  
  const snapshot = await logsRef.where("timestamp", ">=", admin.firestore.Timestamp.fromDate(startOfDay)).get();
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
  getInventory, 
  logTransaction, 
  getTodayTransactions 
};

