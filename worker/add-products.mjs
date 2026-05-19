// One-off script: appends new products to live KV catalog
// Usage: node add-products.mjs <worker-url> <username> <password>

const [,,workerUrl, username, password] = process.argv;
if (!workerUrl || !username || !password) {
  console.error('Usage: node add-products.mjs <worker-url> <username> <password>');
  process.exit(1);
}

const newProducts = [
  {
    id: "selenite-dragonfly-plate",
    name: 'Satin Spar "Selenite" Etched Dragonfly Charging Plate',
    category: "tools",
    price: 22.22,
    bundle: "",
    stock: 10,
    images: [],
    description: `This satin spar selenite charging plate is a powerful tool for cleansing and recharging your crystals, jewelry, and sacred items. Known for its high vibrational energy, selenite is believed to clear stagnant or negative energy and restore a natural, balanced flow.\n\nEach plate is handcrafted in Morocco, featuring soft, glowing, fibrous lines that beautifully reflect light. Approximately 5 inches wide and 1/2 inch thick — the ideal size for holding multiple crystals or serving as a centerpiece in your space.\n\nEnergetically, selenite is associated with clarity, peace, and spiritual connection. It is often used to:\n• Cleanse and recharge other crystals\n• Create a calm, peaceful environment\n• Support mental clarity and energetic alignment\n\nUnlike many other stones, selenite does not need to be cleansed and is often used as a constant energy purifier.\n\nAll orders come with a free gift.`
  },
  {
    id: "selenite-mushroom-women-plate",
    name: 'Satin Spar "Selenite" Etched Mushroom Women Charging Plate',
    category: "tools",
    price: 22.22,
    bundle: "",
    stock: 10,
    images: [],
    description: `This satin spar selenite charging plate is a powerful tool for cleansing and recharging your crystals, jewelry, and sacred items. Known for its high vibrational energy, selenite is believed to clear stagnant or negative energy and restore a natural, balanced flow.\n\nEach plate is handcrafted in Morocco, featuring soft, glowing, fibrous lines that beautifully reflect light. Approximately 4.75" tall, 4" wide, and 1/2" thick. Weighs 0.86 lbs.\n\nEnergetically, selenite is associated with clarity, peace, and spiritual connection. It is often used to:\n• Cleanse and recharge other crystals\n• Create a calm, peaceful environment\n• Support mental clarity and energetic alignment\n\nUnlike many other stones, selenite does not need to be cleansed and is often used as a constant energy purifier.\n\nAll orders come with a free gift.`
  },
  {
    id: "selenite-tower-6in",
    name: 'Satin Spar "Selenite" 6 Inch Tower',
    category: "tools",
    price: 15.95,
    bundle: "",
    stock: 20,
    images: [],
    description: `This satin spar selenite charging & cleansing tower is a powerful tool for cleansing and recharging your crystal bracelets and sacred space. Known for its high vibrational energy, selenite is believed to clear stagnant or negative energy and restore a natural, balanced flow.\n\nHandcrafted in Morocco, featuring soft, glowing, fibrous lines that beautifully reflect light. Approximately 6 inches tall and 2 inches wide — the ideal size for charging and cleansing multiple crystal bracelets or serving as a centerpiece in your space.\n\nEnergetically, selenite is associated with clarity, peace, and spiritual connection. It is often used to:\n• Cleanse and recharge other crystals\n• Create a calm, peaceful environment\n• Support mental clarity and energetic alignment\n\nUnlike many other stones, selenite does not need to be cleansed and is often used as a constant energy purifier.\n\nAll orders come with a free gift.`
  },
  {
    id: "yellow-calcite-pooh-bear",
    name: "Yellow Calcite Crystal Pooh Bear",
    category: "carvings",
    price: 30.95,
    bundle: "",
    stock: 20,
    images: [],
    description: `Bring a little sunshine and sweetness into your space with this adorable Yellow Calcite Pooh Bear carving. Hand-shaped from natural yellow calcite and finished with delicate painted accents, this piece blends playful charm with uplifting energy.\n\nYellow calcite is known for its bright, joyful vibration — associated with boosting confidence, enhancing motivation, releasing doubt and anxiety, and supporting you in your soul's purpose. It also supports mental clarity, creativity, and a positive outlook.\n\nDetails:\n• Natural yellow calcite with painted accents\n• Approx. weight: 0.27 lbs\n• Size: about 2" tall × 2" wide × 2" thick\n• Each piece is unique in color and pattern\n\nAll orders include a free gift.\n\nInvite in light, joy, and a little bit of magic with this one-of-a-kind crystal companion.`
  },
  {
    id: "yooperlite-owl",
    name: 'Emberlite "Yooperlite" Hand-Carved Owl',
    category: "carvings",
    price: 39.95,
    bundle: "",
    stock: 2,
    images: [],
    description: `A glowing companion for those seeking light, insight, and a little bit of magic.\n\nThis beautifully hand-carved owl is crafted from emberlite, commonly known as "Yooperlite" — a unique stone famous for its mesmerizing fiery glow under UV light, due to fluorescent sodalite minerals within.\n\nOwls symbolize wisdom, intuition, and protection, making this piece both meaningful and eye-catching.\n\nDetails:\n• Size: Approximately 3" tall, 2.5" wide, and 2" thick\n• Material: Natural emberlite (Yooperlite)\n• Hand-carved with unique variations in each piece\n\nMetaphysical Properties: Yooperlite is known for lighting the fire within, supporting decision making, and promoting inner truth, clarity, and emotional release. It's believed to help you express your authentic self while supporting personal growth and transformation.\n\nAll orders include a free gift.`
  },
  {
    id: "purple-labradorite-palmstone",
    name: "Rare Purple Labradorite Palmstone",
    category: "crystals",
    price: 13.33,
    bundle: "",
    stock: 1,
    images: [],
    description: `This rare purple labradorite palmstone features beautiful flashes of violet and iridescent shimmer, known as labradorescence — a natural optical effect caused by light reflecting within the stone's layers.\n\nSize: Approx. 1.9" wide, 1.4" long, 0.6" thick\nWeight: 0.07 lbs\n\nLabradorite is known as a stone of intuition, protection, and transformation — perfect for carrying, meditation, or display. It also helps attune you to the magick of the universe and supports psychic development.\n\n• Clear stand not included\n• Includes a free gift\n\nA stunning, high-vibe addition to any collection — you will receive this exact piece.`
  }
];

// 1. Login
console.log('Logging in...');
const loginRes = await fetch(`${workerUrl}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password })
});
if (!loginRes.ok) {
  console.error('Login failed:', loginRes.status, await loginRes.text());
  process.exit(2);
}
const { token } = await loginRes.json();
console.log('Logged in.');

// 2. Fetch current catalog
console.log('Fetching current catalog...');
const catRes = await fetch(`${workerUrl}/api/products`);
const catalog = await catRes.json();
console.log(`Current products: ${catalog.products.length}`);

// 3. Merge — skip if ID already exists
const existingIds = new Set(catalog.products.map(p => p.id));
const toAdd = newProducts.filter(p => {
  if (existingIds.has(p.id)) {
    console.log(`  Skipping (already exists): ${p.id}`);
    return false;
  }
  return true;
});
console.log(`Adding ${toAdd.length} new products...`);
catalog.products = [...catalog.products, ...toAdd];
catalog.updated = new Date().toISOString().slice(0,10);

// 4. PUT updated catalog
const putRes = await fetch(`${workerUrl}/api/products`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  body: JSON.stringify(catalog)
});
const result = await putRes.json();
console.log('Result:', putRes.status, JSON.stringify(result));
if (putRes.ok) {
  console.log(`Done. Catalog now has ${catalog.products.length} products.`);
} else {
  process.exit(3);
}
