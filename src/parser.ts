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
  "meeru stock","enni unnai","enni unnai","list cheppu","cheppandi",
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
  if (/^(add|sold|stock|restock|update):?\s*$/.test(msg))
    return { action: "skip" };

  // 2. GREETING — exact match from list
  if (greetingWords.some(w => msg === w || msg.startsWith(w + " ")))
    return { action: "greeting" };

  // 3. INVENTORY — standalone keywords
  if (msg === "stock" || msg === "list" || msg === "nilava" || msg === "inventory" || msg === "maal" || inventoryWords.some(w => msg.includes(w)))
    return { action: "inventory" };

  // 4. REPORT — check before number-based parsing
  if (reportWords.some(w => msg.includes(w)))
    return { action: "report" };

  // 5. BULK ADD — "add 10 soaps 5 chips 3 oil"
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

  // 6. FIND NUMBER + UNIT + ITEM (Number-First)
  // Updated regex: optional unit capture
  const numMatch = msg.match(/^(\d+)\s*(kg|kgs|kilo|g|gm|l|ltr|ml|pkt|box|bottle|btl|pcs?|dozen|bag|roll)?\s+(.+)$/i);
  if (numMatch) {
    const qty = parseInt(numMatch[1]);
    const unit = numMatch[2] || "";
    const item = cleanItemName(numMatch[3]);
    const isSold = soldVerbs.some(v => msg.includes(v));
    if (isSold) return { action: "sold", quantity: qty, unit, item };
    return { action: "add", quantity: qty, unit, item };
  }

  // 7. SUPPORT NUMBER-LAST FORMAT
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
  reportWords
};

