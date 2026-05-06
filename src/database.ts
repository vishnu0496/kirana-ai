import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

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

async function updateStock(phone: string, item: string, quantity: number, action: "ADD" | "SELL") {
  const itemKey = item.toLowerCase().trim();
  const itemDocRef = db.collection("shops").doc(phone).collection("inventory").doc(itemKey);
  
  let newQty = 0;
  await db.runTransaction(async (transaction) => {
    const itemDoc = await transaction.get(itemDocRef);
    const currentQty = itemDoc.exists ? (itemDoc.data() as any).quantity : 0;
    newQty = action === "ADD" 
      ? currentQty + quantity 
      : Math.max(0, currentQty - quantity);
    
    transaction.set(itemDocRef, {
      name: item,
      quantity: newQty,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
  return newQty;
}

async function getInventory(phone: string) {
  const snapshot = await db.collection("shops").doc(phone).collection("inventory").get();
  return snapshot.docs.map(doc => doc.data());
}

async function logTransaction(phone: string, action: string, item: string, quantity: number) {
  const logsRef = db.collection("shops").doc(phone).collection("logs");
  await logsRef.add({
    action,
    item,
    quantity,
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
  updateStock, 
  getInventory, 
  logTransaction, 
  getTodayTransactions 
};
