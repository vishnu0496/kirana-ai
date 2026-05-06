const replyTemplates = {
  english: {
    askShopName: "Welcome to Kirana AI! 👋\nWhat is your shop name?",
    shopRegistered: (shop: string) =>
      `Great! ${shop} registered ✅\nWhat is your name?`,
    welcomeUser: (name: string, shop: string) =>
      `Welcome ${name}! 🎉\n${shop} is ready on Kirana AI.\n\nTry these:\n• add 10 soaps\n• sold 5 chips\n• show inventory\n• today report`,
    addSuccess: (qty: number, item: string, total: number, unit: string = "") =>
      `Added ${qty} ${unit} ${item}! 📦 Total stock: ${total} ${unit}`.replace(/\s+/g, " "),
    addSuccessWithMerge: (qty: number, unit: string, typed: string, matched: string, total: number) =>
      `Added ${qty}${unit ? " "+unit : ""} to '${matched}'! 📦 (I matched '${typed}' → '${matched}') Total: ${total}`,
    soldSuccess: (qty: number, item: string, remaining: number, unit: string = "") =>
      `Sold ${qty} ${unit} ${item}! 🛒 Remaining: ${remaining} ${unit}`.replace(/\s+/g, " "),
    lowStock: (item: string, remaining: number, unit: string = "") =>
      `⚠️ Low stock: ${item} only ${remaining} ${unit} left — reorder soon!`.replace(/\s+/g, " "),
    outOfStock: (item: string) =>
      `❌ ${item} is out of stock. Please restock first.`,
    bulkAddSuccess: (lines: string) => 
      `Stock updated! 📦\n${lines}`,
    inventoryHeader: (name: string) =>
      `${name}, here is your inventory:`,
    reportHeader: (name: string) =>
      `${name}, here is today's report:`,
    lowStockHeader: (name: string) => `${name}, items to reorder:`,
    lowStockItem: (item: string, qty: number, unit: string) => `⚠️ ${item}: only ${qty}${unit ? " "+unit : ""} left`,
    noLowStock: (name: string) => `${name}, all items have good stock! 🟢`,
    reportRevenue: (total: number) => `💰 Total revenue: ₹${total}`,
    askPrice: (item: string) => `What is the selling price of ${item}? (Reply: price ${item} ₹40)`,
    priceSetSuccess: (item: string, price: number) => `✅ Price for ${item} set to ₹${price}`,
    greeting: (name: string) =>
      `Hey ${name}! 👋 How can I help?\nTry: 'add 10 soaps' or 'show inventory'`,
    notUnderstood:
      "Didn't understand 🙏 Try: 'add 5 chips' or 'show inventory'",
    notUnderstoodHelp: (item1: string, item2: string) => 
      `Didn't get that 🙏\nTry something like:\n• add 10 ${item1}\n• sold 5 ${item2}\n• show inventory`,
    bulkDone: "All updates done! 📦",
  },
  telugu: {
    askShopName:
      "Kirana AI ki swaagatam! 👋\nMee shop peru cheppagalaru?",
    shopRegistered: (shop: string) =>
      `Baagundi! ${shop} register ayyindi ✅\nMee peru cheppandi?`,
    welcomeUser: (name: string, shop: string) =>
      `Swaagatam ${name} anna! 🎉\n${shop} Kirana AI lo ready ga undi.\n\nIvi try cheyyandi:\n• add 10 soaps\n• sold 5 chips\n• show inventory\n• today report`,
    addSuccess: (qty: number, item: string, total: number, unit: string = "") =>
      `${qty} ${unit} ${item} add chesamu! 📦 Meeru unna stock: ${total} ${unit}`.replace(/\s+/g, " "),
    addSuccessWithMerge: (qty: number, unit: string, typed: string, matched: string, total: number) =>
      `'${matched}' ki ${qty}${unit ? " "+unit : ""} add chesamu! 📦 ('${typed}' ante '${matched}' anukunnanu) Total: ${total}`,
    soldSuccess: (qty: number, item: string, remaining: number, unit: string = "") =>
      `${qty} ${unit} ${item} ammamu! 🛒 Migilina stock: ${remaining} ${unit}`.replace(/\s+/g, " "),
    lowStock: (item: string, remaining: number, unit: string = "") =>
      `⚠️ Stock takkuva: ${item} kevalam ${remaining} ${unit} undhi — tvaraga order ivvandi!`.replace(/\s+/g, " "),
    outOfStock: (item: string) =>
      `❌ ${item} stock ledu. Mundu restock cheyyandi.`,
    bulkAddSuccess: (lines: string) => 
      `Stock updated! 📦\n${lines}`,
    inventoryHeader: (name: string) =>
      `${name} anna, mee inventory idi:`,
    reportHeader: (name: string) =>
      `${name} anna, neti report idi:`,
    lowStockHeader: (name: string) => `${name} anna, ee items order ivvandi:`,
    lowStockItem: (item: string, qty: number, unit: string) => `⚠️ ${item}: kevalam ${qty}${unit ? " "+unit : ""} undhi`,
    noLowStock: (name: string) => `${name} anna, anni items stock bagundi! 🟢`,
    reportRevenue: (total: number) => `💰 Mottam aaya: ₹${total}`,
    askPrice: (item: string) => `${item} amme dhara enti? (Reply: ${item} dam 40)`,
    priceSetSuccess: (item: string, price: number) => `✅ ${item} dhara ₹${price} ga set chesamu`,
    greeting: (name: string) =>
      `Baagundi ${name} anna! 👋 Ela help cheyyali?\nTry: 'add 10 soaps' or 'show inventory'`,
    notUnderstood:
      "Artham kaaledu 🙏 Try: 'add 5 chips' or 'show inventory'",
    notUnderstoodHelp: (item1: string, item2: string) => 
      `Artham kaaledu 🙏\nIla try cheyyandi:\n• add 10 ${item1}\n• 5 ${item2} ammamu\n• nilava chupandi`,
    bulkDone: "Anni update ayyayi! 📦",
  },
  hindi: {
    askShopName:
      "Kirana AI mein swagat! 👋\nApka shop ka naam kya hai?",
    shopRegistered: (shop: string) =>
      `Badhiya! ${shop} register ho gaya ✅\nApka naam batayein?`,
    welcomeUser: (name: string, shop: string) =>
      `Swagat hai ${name} bhai! 🎉\n${shop} Kirana AI pe ready hai.\n\nYe try karein:\n• add 10 soaps\n• sold 5 chips\n• show inventory\n• today report`,
    addSuccess: (qty: number, item: string, total: number, unit: string = "") =>
      `${qty} ${unit} ${item} add ho gaya! 📦 Total stock: ${total} ${unit}`.replace(/\s+/g, " "),
    addSuccessWithMerge: (qty: number, unit: string, typed: string, matched: string, total: number) =>
      `'${matched}' mein ${qty}${unit ? " "+unit : ""} add ho gaya! 📦 ('${typed}' se '${matched}' match kiya) Total: ${total}`,
    soldSuccess: (qty: number, item: string, remaining: number, unit: string = "") =>
      `${qty} ${unit} ${item} bik gaya! 🛒 Bacha hua: ${remaining} ${unit}`.replace(/\s+/g, " "),
    lowStock: (item: string, remaining: number, unit: string = "") =>
      `⚠️ Stock kam: ${item} sirf ${remaining} ${unit} bacha — jaldi order karo!`.replace(/\s+/g, " "),
    outOfStock: (item: string) =>
      `❌ ${item} khatam ho gaya. Pehle restock karo.`,
    bulkAddSuccess: (lines: string) => 
      `Stock updated! 📦\n${lines}`,
    inventoryHeader: (name: string) =>
      `${name} bhai, aapki inventory:`,
    reportHeader: (name: string) =>
      `${name} bhai, aaj ki report:`,
    lowStockHeader: (name: string) => `${name} bhai, ye items order karo:`,
    lowStockItem: (item: string, qty: number, unit: string) => `⚠️ ${item}: sirf ${qty}${unit ? " "+unit : ""} bacha`,
    noLowStock: (name: string) => `${name} bhai, sab items ka stock theek hai! 🟢`,
    reportRevenue: (total: number) => `💰 Kul kamai: ₹${total}`,
    askPrice: (item: string) => `${item} ka selling price kya hai? (Reply: ${item} rate 40)`,
    priceSetSuccess: (item: string, price: number) => `✅ ${item} ka rate ₹${price} set ho gaya`,
    greeting: (name: string) =>
      `Kya haal hai ${name} bhai! 👋 Kya help chahiye?\nTry: 'add 10 soaps' ya 'show inventory'`,
    notUnderstood:
      "Samajh nahi aaya 🙏 Try: 'add 5 chips' ya 'show inventory'",
    notUnderstoodHelp: (item1: string, item2: string) => 
      `Samajh nahi aaya 🙏\nAisa try karein:\n• add 10 ${item1}\n• 5 ${item2} becha\n• stock dikao`,
    bulkDone: "Sab update ho gaya! 📦",
  },
};



type Lang = "english" | "telugu" | "hindi";

function getReply(lang: string) {
  return replyTemplates[(lang as Lang)] ?? replyTemplates.english;
}

export { replyTemplates, getReply, type Lang };
