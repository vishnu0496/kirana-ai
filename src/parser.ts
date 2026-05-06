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
  "low stock","low","reorder","order list",
  // Telugu (Tenglish)
  "inventory chupandi","stock chupandi","nilava cheppandi",
  "nilava","emunnayi","em undi","chupandi","sarukulu chupandi",
  "meeru stock","enni unnai","enni unnai","list cheppu","cheppandi",
  "entha undi","entha unnai","enti undi","stock entha","entha stoku",
  "chupandi","meeru","nilava undi","takkuva stock","order cheyyali","enni takkuva",
  "stock takkuva emi undi",
  // Hindi (Hinglish)
  "inventory dikao","stock dikao","list dikao",
  "kya hai","kitna hai","kitna bacha","kya bacha",
  "maal dikao","sab dikao","hisaab","stock batao",
  "poora stock","kitna maal","kam stock","kya order karna"
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

const priceWords = ["price","cost","rate","dam","bhaav","dhara","rs","rupees","rupee","₹","roju","bagundi"];

function cleanItemName(raw: string): string {
  const allVerbs = [...addVerbs, ...soldVerbs,
    // extra noise words that attach to item names
    "ninna","neti","ee roju","aaj","kal","yesterday",
    "the","a","an","some","few"
  ];
  let cleaned = raw.trim().toLowerCase();
  for (const verb of allVerbs) {
    const re = new RegExp(
      `^${verb}\\s+|\\s+${verb}$|^${verb}$`, "gi"
    );
    cleaned = cleaned.replace(re, "").trim();
  }
  return cleaned;
}

function detectLanguage(message: string): "telugu" | "hindi" | "english" {
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

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function findFuzzyMatch(
  newItem: string, 
  existingItems: string[]
): string | null {
  const n = newItem.toLowerCase().trim();
  
  // Exact match
  const exact = existingItems.find(
    e => e.toLowerCase() === n
  );
  if (exact) return exact;

  // One contains the other
  const contains = existingItems.find(e => {
    const e2 = e.toLowerCase();
    return e2.includes(n) || n.includes(e2);
  });
  if (contains) return contains;

  // First word matches (santoor == santoor soap)
  const firstWord = n.split(" ")[0];
  if (firstWord.length >= 4) {
    const firstMatch = existingItems.find(e =>
      e.toLowerCase().startsWith(firstWord)
    );
    if (firstMatch) return firstMatch;
  }

  return null;
}

function smartParse(message: string): any {
  const msg = message.toLowerCase().trim();

  // 1. SKIP HEADER LINES
  // Skip ONLY if line is just a verb with no digits
  if (/^(add|sold|stock|restock|update):?\s*$/.test(msg) && !/\d/.test(msg))
    return { action: "skip" };

  // 2. GREETING — exact match from list
  if (greetingWords.some(w => msg === w || msg.startsWith(w + " ")))
    return { action: "greeting" };

  // 3. LOW STOCK COMMAND
  if (/low\s*stock|takkuva\s*stock|kam\s*stock|reorder/.test(msg))
    return { action: "low_stock" };

  // 4. INVENTORY — standalone keywords
  if (msg === "stock" || msg === "list" || msg === "nilava" || msg === "inventory" || msg === "maal" || inventoryWords.some(w => msg.includes(w)))
    return { action: "inventory" };

  // 5. REPORT — check before number-based parsing
  if (reportWords.some(w => msg.includes(w)))
    return { action: "report" };

  // 6. PRICE SETTING COMMAND
  const priceMatch = msg.match(
    /(?:price|cost|rate|dam|bhaav|dhara|roju)\s+(?:of\s+)?(.+?)\s+(?:is\s+)?(?:rs\.?|₹)?\s*(\d+)/i
  ) || msg.match(
    /(.+?)\s+(?:rs\.?|₹)\s*(\d+)/i
  );
  if (priceMatch && !msg.match(/\d+\s*[a-z]/)) { // Avoid matching "10 soaps"
    const item = cleanItemName(priceMatch[1]);
    const price = parseInt(priceMatch[2]);
    if (item && price) return { action: "set_price", item, price };
  }

  // 7. BULK ADD — unit aware regex
  const bulkMatches = [...msg.matchAll(/(\d+)\s*(kg|kgs|kilo|g|gm|l|ltr|ml|pkt|pkts|box|boxes|bottle|btl|pcs?|dozen|bag|roll)?\s+([a-z][a-z\s]*?)(?=\s*\d|$)/gi)];
  if (msg.startsWith("add") && bulkMatches.length >= 2) {
    return {
      action: "bulk_add",
      items: bulkMatches.map(m => ({
        quantity: parseInt(m[1]),
        unit: m[2] || "",
        item: cleanItemName(m[3])
      }))
    };
  }

  // 8. FIND NUMBER + UNIT + ITEM (Number-First)
  const numMatch = msg.match(/^(\d+)\s*(kg|kgs|kilo|g|gm|l|ltr|ml|pkt|box|bottle|btl|pcs?|dozen|bag|roll)?\s+(.+)$/i);
  if (numMatch) {
    const qty = parseInt(numMatch[1]);
    const unit = numMatch[2] || "";
    const item = cleanItemName(numMatch[3]);
    const isSold = soldVerbs.some(v => msg.includes(v));
    if (isSold) return { action: "sold", quantity: qty, unit, item };
    return { action: "add", quantity: qty, unit, item };
  }

  // 9. SUPPORT NUMBER-LAST FORMAT
  const numLastMatch = msg.match(/^([a-z][\w\s]+?)\s+(\d+)$/);
  if (numLastMatch) {
    const item = cleanItemName(numLastMatch[1].trim());
    const qty = parseInt(numLastMatch[2]);
    const isSold = soldVerbs.some(v => msg.includes(v));
    if (isSold) return { action: "sold", quantity: qty, unit: "", item };
    return { action: "add", quantity: qty, unit: "", item };
  }

  return { action: "unknown" };
}

export { 
  smartParse, 
  detectLanguage, 
  cleanItemName, 
  capitalize,
  addVerbs,
  soldVerbs,
  greetingWords,
  inventoryWords,
  reportWords,
  priceWords
};
