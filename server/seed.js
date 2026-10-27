'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const store = require('./db');
const { hashPassword } = require('./security');
const { writeProductArt } = require('./art');
const { filterComment } = require('./reviewFilter');
const time = require('./time');

const OFFSET = config.timezoneOffsetMinutes;
const DAY = 24 * 60 * 60 * 1000;

const CATEGORIES = ['Clothes', 'Shoes', 'Bags', 'Jackets', 'Accessories', 'Random'];

const STALL_SPECS = [
  {
    id: 1, name: 'Golden Threads', category: 'Clothes', cover: '01.jpg', operating: 'open',
    description: 'Soft everyday clothing in warm neutrals. Linen, cotton and easy layers for slow weekends in the city.',
    location: 'SkyWorld Stall · F. Calderon St. Baguio City, Benguet · Stall 01', phone: '0917 555 0101', email: 'maria.santos@skyworld.ph',
  },
  {
    id: 2, name: 'Soft Layer Co.', category: 'Clothes', cover: '02.jpg', operating: 'open',
    description: 'Breathable linen and relaxed silhouettes in oat, sage and ivory. Made for warm afternoons.',
    location: 'SkyWorld Stall · F. Calderon St. Baguio City, Benguet · Stall 02', phone: '0917 555 0102', email: 'juan.reyes@skyworld.ph',
  },
  {
    id: 3, name: 'Sole Haven', category: 'Shoes', cover: '03.jpg', operating: 'open',
    description: 'Comfort-first footwear, from leather loafers to trail-ready sneakers. Fits checked in store.',
    location: 'SkyWorld Stall · F. Calderon St. Baguio City, Benguet · Stall 03', phone: '0917 555 0103', email: 'ana.cruz@skyworld.ph',
  },
  {
    id: 4, name: 'Step & Stride', category: 'Shoes', cover: '04.jpg', operating: 'open',
    description: 'Streetwear sneakers and easy sandals with dependable soles for city days.',
    location: 'SkyWorld Stall · F. Calderon St. Baguio City, Benguet · Stall 04', phone: '0917 555 0104', email: 'jose.bautista@skyworld.ph',
  },
  {
    id: 5, name: 'The Bag Atelier', category: 'Bags', cover: '05.jpg', operating: 'open',
    description: 'Canvas totes, sling bags and leather carryalls for work, weekends and everything in between.',
    location: 'SkyWorld Stall · F. Calderon St. Baguio City, Benguet · Stall 05', phone: '0917 555 0105', email: 'liza.garcia@skyworld.ph',
  },
  {
    id: 6, name: 'Carry All Co.', category: 'Bags', cover: '06.jpg', operating: 'open',
    description: 'Travel bags and backpacks designed to keep the essentials close and the journey light.',
    location: 'SkyWorld Stall · F. Calderon St. Baguio City, Benguet · Stall 06', phone: '0917 555 0106', email: 'mark.mendoza@skyworld.ph',
  },
  {
    id: 7, name: 'Trinket Corner', category: 'Accessories', cover: '07.jpg', operating: 'open',
    description: 'Small things, big personality. Watches, jewellery, caps and everyday finishing touches.',
    location: 'SkyWorld Stall · F. Calderon St. Baguio City, Benguet · Stall 07', phone: '0917 555 0107', email: 'grace.torres@skyworld.ph',
  },
  {
    id: 8, name: 'Charm & Co.', category: 'Accessories', cover: '08.jpg', operating: 'open',
    description: 'Finishing touches with a quiet shine: fine jewellery, silk scarves and small everyday luxuries.',
    location: 'SkyWorld Stall · F. Calderon St. Baguio City, Benguet · Stall 08', phone: '0917 555 0108', email: 'paolo.ramos@skyworld.ph',
  },
  {
    id: 9, name: 'Layer Loft', category: 'Jackets', cover: '09.jpg', operating: 'open',
    description: 'Lightweight layering pieces and outerwear built for cool Baguio mornings.',
    location: 'SkyWorld Stall · F. Calderon St. Baguio City, Benguet · Stall 09', phone: '0917 555 0109', email: 'carla.flores@skyworld.ph',
  },
  {
    id: 10, name: 'Everyday Finds', category: 'Random', cover: '10.jpg', operating: 'open',
    description: 'Practical little upgrades for daily life — tumblers, lamps, organisers and thoughtful gifts.',
    location: 'SkyWorld Stall · F. Calderon St. Baguio City, Benguet · Stall 10', phone: '0917 555 0110', email: 'ramon.v@skyworld.ph',
  },
  {
    id: 11, name: 'Mixed Mart', category: 'Random', cover: '01.jpg', operating: 'open',
    description: 'A rotating mix of everyday essentials, seasonal finds and practical gifts for the home.',
    location: 'SkyWorld Stall · F. Calderon St. Baguio City, Benguet · Stall 11', phone: '0917 555 0111', email: 'jenny.castillo@skyworld.ph',
  },
];

const TEMPLATES = {
  Clothes: [
    { name: 'Cotton Crew Tee', price: 14950, sizes: 'clothes', desc: '100% combed cotton crew-neck tee with a clean, relaxed fit.' },
    { name: 'Oversized Graphic Tee', price: 29975, sizes: 'clothes', desc: 'Loose-fit tee with a faded SkyWorld graphic print and dropped shoulders.' },
    { name: 'Piqué Polo Shirt', price: 34900, sizes: 'clothes', desc: 'Textured piqué polo with a soft collar and mother-of-pearl buttons.' },
    { name: 'Straight-Cut Denim Jeans', price: 59950, sizes: 'clothes', desc: 'Mid-rise straight jeans with a hint of stretch and a clean ankle hem.' },
    { name: 'Cargo Pants', price: 54925, sizes: 'clothes', desc: 'Six-pocket cotton cargo pants with adjustable hems and a comfortable waist.' },
    { name: 'Floral Midi Dress', price: 49999, sizes: 'clothes', desc: 'Lightweight floral midi dress with a smocked bodice and lined skirt.' },
    { name: 'Puff-Sleeve Blouse', price: 32975, sizes: 'clothes', desc: 'Airy blouse with gathered puff sleeves and a covered button placket.' },
    { name: 'Ribbed Tank Top', price: 14950, sizes: 'clothes', desc: 'Stretch ribbed tank with a square neckline, made for layering.' },
    { name: 'A-Line Midi Skirt', price: 29950, sizes: 'clothes', desc: 'High-waist A-line skirt in a soft woven fabric with side pockets.' },
    { name: 'Everyday Jogger Pants', price: 39975, sizes: 'clothes', desc: 'Brushed cotton joggers with a tapered leg, elastic waist and side pockets.' },
    { name: 'Linen Button Shirt', price: 44975, sizes: 'clothes', desc: 'Breathable linen-blend shirt with a camp collar and horn buttons.' },
    { name: 'Knit Lounge Set', price: 64950, sizes: 'clothes', desc: 'Two-piece knit lounge set with a relaxed top and matching wide-leg trousers.' },
  ],
  Shoes: [
    { name: 'Canvas Sneakers', price: 79950, sizes: 'shoes', desc: 'Low-top cotton canvas sneakers with a vulcanised rubber sole.' },
    { name: 'Running Shoes', price: 149975, sizes: 'shoes', desc: 'Cushioned daily trainers with breathable mesh and a grippy outsole.' },
    { name: 'Rubber Slides', price: 24900, sizes: 'shoes', desc: 'Soft EVA slides with a moulded footbed, easy to wipe clean.' },
    { name: 'Leather Loafers', price: 110050, sizes: 'shoes', desc: 'Slip-on loafers in smooth leather with a flexible stacked heel.' },
    { name: 'Basketball Shoes', price: 220000, sizes: 'shoes', desc: 'High-top court shoes with ankle support and a herringbone grip.' },
    { name: 'Strappy Sandals', price: 39999, sizes: 'shoes', desc: 'Adjustable strappy sandals with a padded footbed for all-day wear.' },
    { name: 'Chelsea Boots', price: 160075, sizes: 'shoes', desc: 'Ankle boots with elastic side panels and a pull tab at the heel.' },
    { name: 'Platform Sneakers', price: 99950, sizes: 'shoes', desc: 'Chunky platform sneakers with a lace-up front and cushioned collar.' },
    { name: 'Hiking Shoes', price: 180025, sizes: 'shoes', desc: 'Trail shoes with a reinforced toe cap and anti-slip lug sole.' },
    { name: 'Flip-Flops', price: 14950, sizes: 'shoes', desc: 'Everyday rubber flip-flops with a soft toe post and textured sole.' },
  ],
  Bags: [
    { name: 'Mini Sling Bag', price: 29975, sizes: 'none', desc: 'Compact sling with an adjustable strap. Fits a phone, wallet and keys.' },
    { name: 'Canvas Tote Bag', price: 24950, sizes: 'none', desc: 'Heavyweight canvas tote with an inner pocket and reinforced handles.' },
    { name: 'Leather Handbag', price: 89999, sizes: 'none', desc: 'Structured handbag with a zip closure and detachable shoulder strap.' },
    { name: 'Laptop Backpack 15"', price: 79950, sizes: 'none', desc: 'Water-resistant backpack with a padded 15-inch laptop sleeve.' },
    { name: 'Crossbody Bag', price: 49925, sizes: 'none', desc: 'Everyday crossbody with two compartments and a soft webbing strap.' },
    { name: 'Waist Belt Bag', price: 25975, sizes: 'none', desc: 'Lightweight belt bag with a quick-release buckle, for travel and errands.' },
    { name: 'Travel Duffel Bag', price: 95050, sizes: 'none', desc: 'Roomy duffel with a separate shoe compartment and trolley sleeve.' },
    { name: 'Mini Backpack', price: 45000, sizes: 'none', desc: 'Small backpack for daily essentials, with a secure zip-top opening.' },
    { name: 'Messenger Bag', price: 65075, sizes: 'none', desc: 'Classic messenger bag with a flap cover and multiple interior pockets.' },
    { name: 'Drawstring Gym Bag', price: 19950, sizes: 'none', desc: 'Foldable drawstring bag for gym clothes and quick errands.' },
  ],
  Jackets: [
    { name: 'Bomber Jacket', price: 89950, sizes: 'clothes', desc: 'Classic bomber with ribbed cuffs, a zip front and two side pockets.' },
    { name: 'Denim Jacket', price: 99975, sizes: 'clothes', desc: 'Button-up denim jacket with chest pockets and a relaxed fit.' },
    { name: 'Windbreaker', price: 69900, sizes: 'clothes', desc: 'Lightweight windproof shell for breezy mornings and evening walks.' },
    { name: 'Hooded Zip Jacket', price: 75025, sizes: 'clothes', desc: 'Fleece-lined hoodie with a full zip, kangaroo pockets and a drawcord hood.' },
    { name: 'Varsity Jacket', price: 110050, sizes: 'clothes', desc: 'Letterman-style jacket with striped ribbed trim and snap buttons.' },
    { name: 'Knit Cardigan', price: 45075, sizes: 'clothes', desc: 'Soft knit cardigan with a relaxed drape and horn buttons.' },
    { name: 'Fleece Jacket', price: 85000, sizes: 'clothes', desc: 'Warm fleece jacket with two zip pockets and a stand collar.' },
    { name: 'Puffer Jacket', price: 145099, sizes: 'clothes', desc: 'Lightweight insulated puffer with a packable design and zip pockets.' },
  ],
  Accessories: [
    { name: 'Stainless Steel Watch', price: 79950, sizes: 'none', desc: 'Analog watch with a brushed stainless steel strap and mineral glass face.' },
    { name: "Women's Analog Watch", price: 59975, sizes: 'none', desc: 'Slim watch with a mesh strap and a minimalist dial.' },
    { name: 'Silver Pendant Necklace', price: 35000, sizes: 'none', desc: 'Delicate chain necklace with a small polished pendant.' },
    { name: 'Beaded Bracelet', price: 12050, sizes: 'none', desc: 'Hand-knotted beaded bracelet with an adjustable closure.' },
    { name: 'Stud Earring Set', price: 9975, sizes: 'none', desc: 'Set of six hypoallergenic stud earrings in everyday shapes.' },
    { name: 'Aviator Sunglasses', price: 29900, sizes: 'none', desc: 'UV400 aviator sunglasses with a lightweight metal frame.' },
    { name: 'Leather Belt', price: 24950, sizes: 'belt', desc: 'Full-grain leather belt with a brushed pin buckle.' },
    { name: 'Baseball Cap', price: 19975, sizes: 'none', desc: 'Adjustable cotton cap with a curved brim and embroidered eyelets.' },
    { name: 'Silk Scarf', price: 19999, sizes: 'none', desc: 'Lightweight satin scarf that works as a hair tie, bag accent or neck scarf.' },
    { name: 'Hair Clip Set', price: 7950, sizes: 'none', desc: 'Pack of twelve assorted hair clips in warm tortoise and cream tones.' },
    { name: 'Ring Set', price: 14925, sizes: 'none', desc: 'Set of eight stackable rings in mixed finishes.' },
    { name: 'Bifold Wallet', price: 34950, sizes: 'none', desc: 'Slim bifold wallet with card slots, a bill pocket and a coin zip.' },
  ],
  Random: [
    { name: 'Wireless Earbuds', price: 59950, sizes: 'none', desc: 'Bluetooth earbuds with a pocket charging case and touch controls.' },
    { name: 'Phone Case', price: 14975, sizes: 'none', desc: 'Shockproof phone case with a soft inner lining and matte shell.' },
    { name: 'Power Bank 10000mAh', price: 69900, sizes: 'none', desc: 'Dual-port power bank with an LED indicator and USB-C input.' },
    { name: 'Foldable Umbrella', price: 24950, sizes: 'none', desc: 'Compact auto-open umbrella with a wind-resistant frame.' },
    { name: 'Water Tumbler 500ml', price: 39975, sizes: 'none', desc: 'Double-wall stainless tumbler that keeps drinks cold for hours.' },
    { name: 'Scented Candle', price: 19999, sizes: 'none', desc: 'Soy wax candle in a reusable ceramic jar, soft lavender and cedar scent.' },
    { name: 'LED Desk Lamp', price: 44925, sizes: 'none', desc: 'Rechargeable desk lamp with three brightness levels and a warm glow.' },
    { name: 'Bluetooth Speaker', price: 79950, sizes: 'none', desc: 'Portable splash-resistant speaker with a woven strap.' },
    { name: 'Phone Tripod', price: 34975, sizes: 'none', desc: 'Flexible tripod with a Bluetooth shutter remote for photos and reels.' },
    { name: 'Sticker Pack', price: 7950, sizes: 'none', desc: 'Pack of fifty waterproof vinyl stickers in a latte-inspired palette.' },
    { name: 'Planner Notebook', price: 15950, sizes: 'none', desc: 'A5 undated planner with a hard cover, ribbon marker and monthly spreads.' },
    { name: 'Keychain Charm', price: 5975, sizes: 'none', desc: 'Small brass keychain charm with a hand-finished enamel detail.' },
  ],
};

const SIZE_SETS = {
  clothes: ['S', 'M', 'L', 'XL'],
  shoes: ['38', '39', '40', '41', '42', '43'],
  belt: ['S', 'M', 'L'],
  none: [],
};

const PALETTES = {
  Clothes: [
    { name: 'Espresso', hex: '#4A3728' }, { name: 'Oat', hex: '#D8C7AE' },
    { name: 'Sage', hex: '#9AA88D' }, { name: 'Terracotta', hex: '#B96F52' },
    { name: 'Ivory', hex: '#F1E9DB' },
  ],
  Shoes: [
    { name: 'Chalk', hex: '#EFE8DC' }, { name: 'Tan', hex: '#B0845F' },
    { name: 'Charcoal', hex: '#33312E' }, { name: 'Cognac', hex: '#8A5A3B' },
    { name: 'Olive', hex: '#77775B' },
  ],
  Bags: [
    { name: 'Tan Leather', hex: '#B08155' }, { name: 'Chocolate', hex: '#6E4B33' },
    { name: 'Cream Canvas', hex: '#DDCDB4' }, { name: 'Olive', hex: '#74705A' },
    { name: 'Black', hex: '#2D2A27' },
  ],
  Jackets: [
    { name: 'Denim', hex: '#52677D' }, { name: 'Khaki', hex: '#A58B64' },
    { name: 'Espresso', hex: '#4A3728' }, { name: 'Olive', hex: '#74705A' },
    { name: 'Rust', hex: '#A75C40' },
  ],
  Accessories: [
    { name: 'Gold', hex: '#C7A24A' }, { name: 'Silver', hex: '#BFC0BE' },
    { name: 'Black', hex: '#2D2A27' }, { name: 'Rose Gold', hex: '#C98F7F' },
    { name: 'Cognac', hex: '#8A5A3B' },
  ],
  Random: [
    { name: 'Sage', hex: '#7D8A72' }, { name: 'Oat', hex: '#D8C7AE' },
    { name: 'Charcoal', hex: '#3A3733' }, { name: 'Clay', hex: '#B46F56' },
    { name: 'Stone', hex: '#A79E8F' },
  ],
};

const FIRST = ['Maria', 'Juan', 'Ana', 'Jose', 'Liza', 'Mark', 'Grace', 'Paolo', 'Carla', 'Ramon', 'Jenny', 'Rico', 'Nina', 'Carlo', 'Ella', 'Dennis', 'Joy', 'Miguel', 'Tess', 'Allan', 'Mika', 'Bea', 'Luis', 'Trina'];
const LAST = ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Garcia', 'Mendoza', 'Torres', 'Ramos', 'Flores', 'Villanueva', 'Castillo', 'Aquino', 'Navarro', 'Domingo', 'Salazar', 'Lim', 'Tan', 'Gonzales'];
const CITIES = ['Baguio City', 'La Trinidad, Benguet', 'Quezon City', 'Manila', 'Pasig City', 'Cebu City', 'Davao City'];
const STREETS = ['Session Road', 'Assumption Road', 'Bonifacio Street', 'Mabini Street', 'Rizal Avenue', 'Harrison Road'];

const REVIEW_COMMENTS = [
  'The fabric feels lovely and the colour is just like the photos. Packed neatly, too.',
  'Arrived quickly in Baguio and the size guide was accurate. Would order again.',
  'Really happy with this. The quality is better than I expected for the price.',
  'The seller answered my question right away. Item was exactly as described.',
  'Love the warm colour. It is now my favourite piece in my wardrobe.',
  'Good value. There was a tiny crease from packing but it came out after a wash.',
  'Ordered two colours and both look beautiful. Smooth transaction overall.',
  'The size runs a little small, but the quality is good and the seller was helpful.',
];

const TICKET_SEEDS = [
  ['Flickering canopy lights', 'Two LED bulbs above the front display flicker intermittently during the afternoon peak.', 'electrical', 'normal', 'in_progress', 4, 1],
  ['POS tablet cannot connect', 'The stall tablet disconnects from the mall Wi-Fi every few minutes and the order screen needs refreshing.', 'technical', 'high', 'open', 2, 2],
  ['Drain smell near counter', 'A faint drain smell appears after heavy rain. Requesting a maintenance check before the weekend.', 'plumbing', 'normal', 'open', 9, 3],
  ['Signage bracket loose', 'The upper signage bracket on the left side is loose. Please check before it falls.', 'maintenance', 'urgent', 'in_progress', 7, 1],
  ['Deep cleaning request', 'Requesting floor and glass cleaning after the weekend market crowd.', 'cleaning', 'low', 'resolved', 3, 1],
  ['Customer complaint follow-up', 'A customer reported receiving the wrong colour. The stall has arranged an exchange.', 'customer', 'normal', 'closed', 1, 5],
  ['Card reader power issue', 'The backup card reader does not power on even after changing the cable.', 'technical', 'high', 'open', 8, 2],
  ['Awning alignment', 'The canvas awning is no longer aligned with the frame and lets rain through at one corner.', 'maintenance', 'normal', 'resolved', 6, 3],
];

const SAMPLE_ACTIVITY = [
  ['admin', 'Seeded demonstration platform settings', 'settings.updated'],
  ['admin', 'Reviewed the October occupancy roster', 'stall.roster_reviewed'],
  ['operator', 'Recorded a monthly stall visit', 'visit.recorded'],
  ['operator', 'Updated a support ticket status', 'ticket.updated'],
  ['owner', 'Updated the stall cover photo', 'stall.profile_updated'],
  ['owner', 'Created a new product draft', 'product.created'],
  ['owner', 'Updated stock for a low-stock item', 'product.updated'],
  ['admin', 'Generated a platform sales report preview', 'report.previewed'],
  ['operator', 'Checked stalls on the evening rounds', 'stall.checked'],
  ['admin', 'Reviewed a flagged customer review', 'review.reviewed'],
];

function makeRng(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

function shuffle(random, list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function localIso(year, month, day, hour = 10, minute = 0) {
  return time.localIso(year, month, day, hour, minute, OFFSET);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function resetDatabase() {
  store.tx(() => {
    const tables = [
      'sessions', 'password_resets', 'rate_limits', 'notifications', 'activity_logs',
      'reviews', 'order_items', 'orders', 'tickets', 'visits', 'suppliers', 'feedback',
      'vouchers', 'products', 'users', 'stalls',
    ];
    for (const table of tables) store.run(`DELETE FROM ${table}`);
    store.run("DELETE FROM sqlite_sequence WHERE name IN ('users','products','orders','order_items','reviews','notifications','activity_logs','tickets','visits','suppliers','feedback','password_resets')");
  });
  const productDir = path.join(config.publicDir, 'shared', 'products');
  if (fs.existsSync(productDir)) {
    for (const file of fs.readdirSync(productDir)) {
      if (file.endsWith('.svg')) fs.rmSync(path.join(productDir, file), { force: true });
    }
  }
}

function seedDatabase({ reset = false, quiet = false } = {}) {
  const existing = store.get('SELECT COUNT(*) AS count FROM stalls');
  if (existing && existing.count > 0 && !reset) {
    return { seeded: false, reason: 'already_seeded' };
  }
  if (reset) resetDatabase();

  const random = makeRng(20261021);
  const nowMs = Date.now();
  const today = time.localParts(nowMs, OFFSET);
  const todayDate = `${today.year}-${pad(today.month)}-${pad(today.day)}`;
  const nowIso = new Date(nowMs).toISOString();
  const settings = {
    commissionPct: Number(store.getSetting('commission_pct', '5')),
    shippingFee: Number(store.getSetting('shipping_fee_cents', '4900')),
    freeShipping: Number(store.getSetting('free_shipping_threshold_cents', '200000')),
    words: store.parseJson(store.getSetting('prohibited_words', '[]'), []),
    filterEnabled: store.getSetting('review_filter_enabled', '1') === '1',
  };

  const userRows = {
    admin: { name: 'Rafael Mendoza', email: 'admin.rafael@skyworld.ph', phone: '0917 880 1001', role: 'admin', password: 'Admin@Sky2026' },
    operator: { name: 'Sofia Reyes', email: 'operator.sofia@skyworld.ph', phone: '0917 880 1002', role: 'operator', password: 'Operator@Sky2026' },
    owner: { name: 'Maria Santos', email: 'maria.santos@skyworld.ph', phone: '0917 555 0101', role: 'owner', password: 'Stall1@Clothes' },
  };

  let adminId;
  let operatorId;
  let ownerId;
  const productsByStall = new Map();

  store.tx(() => {
    for (const spec of STALL_SPECS) {
      const leaseRent = 1500000 + spec.id * 95000;
      store.run(
        `INSERT INTO stalls(id, name, category, description, location, cover_image, profile_image, gallery,
          contact_phone, contact_email, operating_status, occupancy, commission_pct,
          lease_start, lease_end, lease_rent_cents, lease_area_sqm, lease_is_sample, lease_note,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', NULL, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [
          spec.id, spec.name, spec.category, spec.description, spec.location,
          `/shared/covers/${spec.cover}`, `/shared/covers/${spec.cover}`,
          JSON.stringify([`/shared/covers/${spec.cover}`, '/shared/covers/gallery-1.jpg', '/shared/covers/gallery-2.jpg']),
          spec.phone, spec.email, spec.operating,
          '2025-01-01', '2026-12-31', leaseRent,
          String(12 + spec.id), 'Demonstration lease record — sample only, not a real agreement or financial commitment.',
          nowIso, nowIso,
        ]
      );
    }

    for (const key of ['admin', 'operator', 'owner']) {
      const user = userRows[key];
      const result = store.run(
        `INSERT INTO users(name, email, phone, password_hash, role, status, stall_id, created_at, updated_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
        [
          user.name, user.email, user.phone, hashPassword(user.password), user.role,
          key === 'owner' ? 1 : null,
          nowIso, nowIso, new Date(nowMs - 2 * DAY).toISOString(),
        ]
      );
      if (key === 'admin') adminId = Number(result.lastInsertRowid);
      if (key === 'operator') operatorId = Number(result.lastInsertRowid);
      if (key === 'owner') ownerId = Number(result.lastInsertRowid);
    }

    // Seed remaining stall owners (stalls 2–11)
    const EXTRA_OWNERS = [
      { name: 'Juan Reyes', email: 'juan.reyes@skyworld.ph', phone: '0917 555 0102', password: 'Stall2@Clothes', stallId: 2 },
      { name: 'Ana Cruz', email: 'ana.cruz@skyworld.ph', phone: '0917 555 0103', password: 'Stall3@Shoes', stallId: 3 },
      { name: 'Jose Bautista', email: 'jose.bautista@skyworld.ph', phone: '0917 555 0104', password: 'Stall4@Shoes', stallId: 4 },
      { name: 'Liza Garcia', email: 'liza.garcia@skyworld.ph', phone: '0917 555 0105', password: 'Stall5@Bags', stallId: 5 },
      { name: 'Mark Mendoza', email: 'mark.mendoza@skyworld.ph', phone: '0917 555 0106', password: 'Stall6@Bags', stallId: 6 },
      { name: 'Grace Torres', email: 'grace.torres@skyworld.ph', phone: '0917 555 0107', password: 'Stall7@Accessories', stallId: 7 },
      { name: 'Paolo Ramos', email: 'paolo.ramos@skyworld.ph', phone: '0917 555 0108', password: 'Stall8@Accessories', stallId: 8 },
      { name: 'Carla Flores', email: 'carla.flores@skyworld.ph', phone: '0917 555 0109', password: 'Stall9@Jackets', stallId: 9 },
      { name: 'Ramon Villanueva', email: 'ramon.v@skyworld.ph', phone: '0917 555 0110', password: 'Stall10@Random', stallId: 10 },
      { name: 'Jenny Castillo', email: 'jenny.castillo@skyworld.ph', phone: '0917 555 0111', password: 'Stall11@Random', stallId: 11 },
    ];
    for (const o of EXTRA_OWNERS) {
      store.run(
        `INSERT INTO users(name, email, phone, password_hash, role, status, stall_id, created_at, updated_at, last_login_at)
         VALUES (?, ?, ?, ?, 'owner', 'active', ?, ?, ?, ?)`,
        [o.name, o.email, o.phone, hashPassword(o.password), o.stallId, nowIso, nowIso, new Date(nowMs - 2 * DAY).toISOString()]
      );
      store.run('UPDATE stalls SET occupancy = ? WHERE id = ?', ['occupied', o.stallId]);
    }
    store.run('UPDATE stalls SET occupancy = ? WHERE id = 1', ['occupied']);

    for (const spec of STALL_SPECS) {
      const templates = shuffle(
        makeRng(9000 + spec.id),
        TEMPLATES[spec.category]
      ).slice(0, 8);
      // Keep the anchor products predictable for reviewers of the demo.
      if (spec.id === 1 && !templates.some((product) => product.name === 'Cotton Crew Tee')) {
        templates[0] = TEMPLATES.Clothes[0];
      }
      if (spec.id === 2 && !templates.some((product) => product.name === 'Flip-Flops')) {
        templates[7] = TEMPLATES.Shoes[9];
      }
      const palette = PALETTES[spec.category];
      const stallProducts = [];
      templates.forEach((template, index) => {
        const colorCount = 2 + (index % 3);
        const chosenColors = [];
        const start = (spec.id + index) % palette.length;
        for (let i = 0; i < palette.length && chosenColors.length < colorCount; i += 1) {
          const color = palette[(start + i) % palette.length];
          if (!chosenColors.some((entry) => entry.name === color.name)) chosenColors.push({ ...color });
        }
        while (chosenColors.length < 2) chosenColors.push({ ...palette[(start + chosenColors.length + 1) % palette.length] });
        const sizes = SIZE_SETS[template.sizes] || [];
        const stockPattern = [0, 7, 26, 41, 3, 18, 54, 9];
        const discountPattern = [0, 10, 0, 15, 0, 20, 0, 10];
        const stock = stockPattern[index] + (spec.id % 3);
        const sku = `SW-${spec.category.slice(0, 2).toUpperCase()}-${pad(spec.id)}-${pad(index + 1)}`;
        const createdAt = new Date(nowMs - (300 - index * 9 - spec.id * 4) * DAY).toISOString();
        const result = store.run(
          `INSERT INTO products(stall_id, name, description, category, price_cents, discount_pct, stock,
            colors, sizes, images, sku, featured, archived, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, '[]', ?, ?, 0, ?, ?)`,
          [
            spec.id, template.name, template.desc, spec.category, template.price,
            discountPattern[index], stock, JSON.stringify(sizes), sku,
            index === 2 || index === 5 ? 1 : 0,
            createdAt, createdAt,
          ]
        );
        const productId = Number(result.lastInsertRowid);
        const art = writeProductArt(config.publicDir, {
          id: productId,
          name: template.name,
          category: spec.category,
          colors: chosenColors,
        });
        store.run('UPDATE products SET colors = ?, images = ? WHERE id = ?', [
          JSON.stringify(art.colors), JSON.stringify(art.images), productId,
        ]);
        stallProducts.push({
          id: productId,
          stallId: spec.id,
          name: template.name,
          category: spec.category,
          priceCents: template.price,
          discountPct: discountPattern[index],
          stock,
          sizes,
          colors: art.colors,
          featured: index === 2 || index === 5,
        });
      });
      productsByStall.set(spec.id, stallProducts);
    }

    store.run(
      `INSERT INTO vouchers(code, type, value, min_subtotal_cents, max_uses, used_count, active, expires_at, is_sample, created_at)
       VALUES ('SKY50', 'fixed', 5000, 50000, 500, 0, 1, NULL, 1, ?)`,
      [nowIso]
    );
    store.run(
      `INSERT INTO vouchers(code, type, value, min_subtotal_cents, max_uses, used_count, active, expires_at, is_sample, created_at)
       VALUES ('LATTE10', 'percent', 10, 100000, 100, 0, 1, NULL, 1, ?)`,
      [nowIso]
    );

    const rawOrders = [];
    const yearStart = 2025;
    const monthEnd = today.month;
    const yearNow = today.year;

    // 2025 and earlier 2026 months: two sample orders per stall per month.
    for (let year = yearStart; year <= yearNow; year += 1) {
      const lastMonth = year === yearNow ? monthEnd - 1 : 12;
      for (let month = 1; month <= lastMonth; month += 1) {
        for (const spec of STALL_SPECS) {
          for (let n = 0; n < 2; n += 1) {
            const day = 5 + ((spec.id * 7 + n * 11 + month * 3) % 19);
            const ts = localIso(year, month, day, 10 + ((spec.id + n) % 7), (spec.id * 13 + n * 17) % 60);
            if (year === yearNow && month === monthEnd) continue;
            const roll = random();
            const status = roll < 0.84 ? 'delivered' : roll < 0.92 ? 'cancelled' : 'refunded';
            rawOrders.push({ stall: spec, ts, status, sequence: rawOrders.length });
          }
        }
      }
    }

    // Recent days: keep daily, weekly and pending work visible.
    for (let daysAgo = 7; daysAgo >= 1; daysAgo -= 1) {
      const dateMs = nowMs - daysAgo * DAY;
      const p = time.localParts(dateMs, OFFSET);
      for (const spec of STALL_SPECS) {
        const status = daysAgo >= 4 ? (random() < 0.08 ? 'refunded' : 'delivered')
          : daysAgo === 3 ? 'delivered'
            : daysAgo === 2 ? 'shipped'
              : 'confirmed';
        const ts = localIso(p.year, p.month, p.day, 9 + (spec.id % 8), (spec.id * 7 + daysAgo * 5) % 60);
        rawOrders.push({ stall: spec, ts, status, sequence: rawOrders.length });
      }
    }

    // Current month earlier days.
    for (let day = 2; day <= Math.min(today.day - 1, 19); day += 3) {
      for (const spec of STALL_SPECS) {
        const status = random() < 0.83 ? 'delivered' : random() < 0.5 ? 'cancelled' : 'refunded';
        rawOrders.push({
          stall: spec,
          ts: localIso(today.year, today.month, day, 11 + (spec.id % 5), (spec.id * 11) % 60),
          status,
          sequence: rawOrders.length,
        });
      }
    }

    // Today: guaranteed delivered sales for daily reports plus pending work.
    const dayStart = Date.parse(localIso(today.year, today.month, today.day, 0, 0));
    for (const spec of STALL_SPECS) {
      const deliveredTs = new Date(Math.max(dayStart + 5 * 60000, nowMs - (spec.id + 1) * 11 * 60000)).toISOString();
      rawOrders.push({ stall: spec, ts: deliveredTs, status: 'delivered', sequence: rawOrders.length, orderLabel: 'delivered today' });
      const pendingTs = new Date(Math.max(dayStart + 8 * 60000, nowMs - (spec.id + 1) * 7 * 60000)).toISOString();
      rawOrders.push({ stall: spec, ts: pendingTs, status: 'pending', sequence: rawOrders.length, orderLabel: 'pending today' });
      if (spec.id % 2 === 1) {
        const confirmedTs = new Date(Math.max(dayStart + 12 * 60000, nowMs - (spec.id + 1) * 4 * 60000)).toISOString();
        rawOrders.push({ stall: spec, ts: confirmedTs, status: 'confirmed', sequence: rawOrders.length });
      }
    }

    rawOrders.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    const counters = {};
    const usedVouchers = {};

    for (const raw of rawOrders) {
      const stallProducts = productsByStall.get(raw.stall.id) || [];
      const chosen = shuffle(random, stallProducts).slice(0, 1 + Math.floor(random() * 3));
      const items = chosen.map((product) => {
        const color = product.colors[Math.floor(random() * product.colors.length)];
        const size = product.sizes.length ? product.sizes[Math.floor(random() * product.sizes.length)] : '';
        const qty = 1 + (random() < 0.24 ? 1 : 0);
        const unit = Math.round(product.priceCents * (100 - product.discountPct) / 100);
        return {
          product,
          qty,
          color: color.name,
          colorHex: color.hex,
          image: color.image,
          size,
          originalUnit: product.priceCents,
          unit,
        };
      });
      const subtotal = items.reduce((sum, item) => sum + item.originalUnit * item.qty, 0);
      const productDiscount = items.reduce((sum, item) => sum + (item.originalUnit - item.unit) * item.qty, 0);
      const eligible = subtotal - productDiscount;
      let voucherCode = null;
      let voucherDiscount = 0;
      if (random() < 0.14 && eligible >= 50000) {
        voucherCode = eligible >= 100000 && random() < 0.4 ? 'LATTE10' : 'SKY50';
        voucherDiscount = voucherCode === 'LATTE10' ? Math.round(eligible * 0.10) : Math.min(5000, eligible);
        usedVouchers[voucherCode] = (usedVouchers[voucherCode] || 0) + 1;
      }
      const shipping = eligible >= settings.freeShipping ? 0 : settings.shippingFee;
      const feePct = raw.stall.commission_pct ?? settings.commissionPct;
      const platformFee = Math.round((eligible - voucherDiscount) * feePct / 100);
      const total = eligible - voucherDiscount + shipping;
      const person = `${pick(random, FIRST)} ${pick(random, LAST)}`;
      const email = `${person.toLowerCase().replace(/[^a-z]+/g, '.')}${Math.floor(random() * 900 + 100)}@example.com`;
      const phone = `+639${Math.floor(100000000 + random() * 899999999)}`;
      const address = `Unit ${1 + Math.floor(random() * 40)}${pick(random, ['A', 'B', 'C'])}, ${pick(random, STREETS)}`;
      const city = pick(random, CITIES);
      const payment = pick(random, ['Cash on Delivery', 'GCash', 'Maya', 'Bank Transfer']);
      const createdYear = time.localParts(Date.parse(raw.ts), OFFSET).year;
      counters[createdYear] = (counters[createdYear] || 0) + 1;
      const code = `SW-${createdYear}-${String(counters[createdYear]).padStart(5, '0')}`;
      const createdMs = Date.parse(raw.ts);
      const deliveredAt = ['delivered', 'refunded'].includes(raw.status)
        ? new Date(Math.min(nowMs, createdMs + (raw.status === 'delivered' ? 45 * 60000 : 28 * 60 * 60000))).toISOString()
        : null;
      const paymentStatus = raw.status === 'delivered' ? 'paid' : raw.status === 'refunded' ? 'refunded' : 'unpaid';

      const orderResult = store.run(
        `INSERT INTO orders(code, stall_id, customer_name, customer_email, customer_phone, address, city, notes,
          subtotal_cents, product_discount_cents, voucher_code, voucher_discount_cents, shipping_cents,
          platform_fee_cents, total_cents, status, payment_method, payment_status, idempotency_key,
          stock_restored, sms_status, sms_detail, is_sample, created_at, updated_at, delivered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 'sample', 'Seeded sample order — no real SMS was sent.', 1, ?, ?, ?)`,
        [
          code, raw.stall.id, person, email, phone, address, city,
          subtotal, productDiscount, voucherCode, voucherDiscount, shipping,
          platformFee, total, raw.status, payment, paymentStatus,
          raw.ts, raw.ts, deliveredAt,
        ]
      );
      const orderId = Number(orderResult.lastInsertRowid);
      for (const item of items) {
        store.run(
          `INSERT INTO order_items(order_id, product_id, product_name, color, color_hex, size, qty,
            original_unit_cents, unit_cents, line_total_cents, image_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            orderId, item.product.id, item.product.name, item.color, item.colorHex, item.size,
            item.qty, item.originalUnit, item.unit, item.unit * item.qty, item.image,
          ]
        );
      }
      if (raw.orderLabel === 'delivered today' && raw.stall.id === 1) {
        raw.seedOrderForReview = orderId;
      }
      raw.orderId = orderId;
      raw.code = code;
    }

    for (const [code, count] of Object.entries(usedVouchers)) {
      store.run('UPDATE vouchers SET used_count = ? WHERE code = ?', [count, code]);
    }

    // Sample customer reviews (published, plus one clearly flagged example).
    const reviewOrders = new Map();
    for (const raw of rawOrders) {
      if (raw.status !== 'delivered') continue;
      if (!reviewOrders.has(raw.stall.id)) reviewOrders.set(raw.stall.id, []);
      reviewOrders.get(raw.stall.id).push(raw);
    }
    for (const spec of STALL_SPECS) {
      const candidates = (reviewOrders.get(spec.id) || []).slice(-6).reverse();
      const selected = candidates.slice(0, 3);
      selected.forEach((raw, index) => {
        const itemRow = store.get('SELECT * FROM order_items WHERE order_id = ? ORDER BY id LIMIT 1', [raw.orderId]);
        if (!itemRow) return;
        const rating = index === 1 ? 4 : index === 2 ? (random() < 0.35 ? 3 : 5) : 5;
        const comment = REVIEW_COMMENTS[(spec.id + index) % REVIEW_COMMENTS.length];
        const createdAt = new Date(Math.min(nowMs - 60000, Date.parse(raw.ts) + 3 * DAY)).toISOString();
        store.run(
          `INSERT INTO reviews(product_id, stall_id, order_id, customer_name, customer_email, rating, comment,
            status, flag_reason, owner_reply, owner_reply_at, is_sample, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'published', '', ?, ?, 1, ?)`,
          [
            itemRow.product_id, spec.id, raw.orderId, raw.code, '',
            rating, comment,
            index === 0 && spec.id === 1 ? 'Thank you for supporting our small stall! We hope to see you again.' : '',
            index === 0 && spec.id === 1 ? new Date(Math.min(nowMs, Date.parse(raw.ts) + 4 * DAY)).toISOString() : null,
            createdAt,
          ]
        );
      });
    }

    // Flagged example linked to a delivered order on stall 1.
    const flaggedOrder = (reviewOrders.get(1) || [])[0];
    if (flaggedOrder) {
      const itemRow = store.get('SELECT * FROM order_items WHERE order_id = ? ORDER BY id LIMIT 1', [flaggedOrder.orderId]);
      if (itemRow) {
        const badComment = 'This seller is a scammer and an idiot. The item is garbage and the service was pathetic.';
        const flagged = filterComment(badComment, settings.words, { enabled: settings.filterEnabled });
        store.run(
          `INSERT INTO reviews(product_id, stall_id, order_id, customer_name, customer_email, rating, comment,
            status, flag_reason, owner_reply, owner_reply_at, is_sample, created_at)
           VALUES (?, 1, ?, 'Sample Moderator Demo', '', 1, ?, 'flagged', ?, '', NULL, 1, ?)`,
          [itemRow.product_id, flaggedOrder.orderId, badComment, flagged.reason || 'Moderation example', new Date(nowMs - 2 * 3600000).toISOString()]
        );
      }
    }

    // Support tickets / maintenance issues.
    TICKET_SEEDS.forEach((seed, index) => {
      const created = new Date(nowMs - (index + 1) * 6 * 3600000).toISOString();
      store.run(
        `INSERT INTO tickets(code, stall_id, title, description, category, priority, status, assigned_to, resolution,
          created_by, is_sample, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          `TK-${today.year}-${String(index + 1).padStart(4, '0')}`,
          seed[5], seed[0], seed[1], seed[2], seed[3], seed[4],
          ['open', 'in_progress'].includes(seed[4]) ? operatorId : null,
          seed[4] === 'resolved' || seed[4] === 'closed' ? 'Checked and addressed by the operations team. Follow-up scheduled.' : '',
          operatorId, created, created,
        ]
      );
    });

    // Sample lease visits, including scheduled October rounds.
    const visitDays = [3, 5, 8, 12, 15, 17, 20, 22, 24, 26];
    for (let i = 0; i < 10; i += 1) {
      const month = today.month === 1 ? 12 : today.month - 1;
      const year = today.month === 1 ? today.year - 1 : today.year;
      const day = Math.min(visitDays[i], time.parseDateParts(`${year}-${pad(month)}-01`).day + 27);
      const visitDate = `${year}-${pad(month)}-${pad(Math.min(day, 27))}`;
      store.run(
        `INSERT INTO visits(stall_id, operator_id, visit_date, purpose, observations, issues, recommended_actions,
          follow_up_status, is_sample, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          i + 1, operatorId, visitDate,
          pick(random, ['Monthly operations check', 'Inventory and safety walkthrough', 'Lease and signage review']),
          'Sample visit: stall was tidy, signage visible and staff present. Recorded for prototype demonstration.',
          i === 3 ? 'A loose bracket was noted near the upper signage.' : '',
          i === 3 ? 'Logged a maintenance ticket and requested a re-check.' : 'No action needed; continue regular monitoring.',
          i === 3 ? 'in_progress' : 'closed',
          new Date(nowMs - (30 - i) * DAY).toISOString(), new Date(nowMs - (28 - i) * DAY).toISOString(),
        ]
      );
    }
    for (let i = 0; i < 4; i += 1) {
      store.run(
        `INSERT INTO visits(stall_id, operator_id, visit_date, purpose, observations, issues, recommended_actions,
          follow_up_status, is_sample, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          i * 2 + 1, operatorId,
          `${today.year}-${pad(today.month)}-${pad(Math.min(today.day + i, 28))}`,
          i === 0 ? 'Scheduled October monitoring visit' : 'Scheduled follow-up visit',
          i === 0 ? 'Sample scheduled visit — demonstration record only.' : 'Sample follow-up record for the prototype.',
          i === 2 ? 'Stall is under maintenance for a lighting check.' : '',
          i === 2 ? 'Operator will verify the lighting repair before reopening.' : 'Confirm status at next visit.',
          i === 0 ? 'pending' : 'in_progress',
          new Date(nowMs - (i + 1) * 3600000).toISOString(), new Date(nowMs - (i + 1) * 3600000).toISOString(),
        ]
      );
    }

    // Suppliers for the demo owner's stall (and one per other stall for completeness).
    const supplierNames = [
      ['Benguet Linen Supply', 'Aling Rosa', '+639175551001', 'wholesale@benguetlinen.example', 'La Trinidad, Benguet'],
      ['Cordillera Canvas Co.', 'Marco Lim', '+639175551002', 'orders@cordilleracanvas.example', 'Baguio City'],
      ['North Leather Studio', 'Dina Cruz', '+639175551003', 'hello@northleather.example', 'San Fernando, La Union'],
    ];
    supplierNames.forEach((supplier) => {
      store.run(
        `INSERT INTO suppliers(stall_id, name, contact_name, phone, email, address, notes, archived, created_at, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, 'Sample supplier record. Payment terms and delivery schedules are illustrative only.', 0, ?, ?)`,
        [...supplier, nowIso, nowIso]
      );
    });
    for (const spec of STALL_SPECS.slice(1)) {
      store.run(
        `INSERT INTO suppliers(stall_id, name, contact_name, phone, email, address, notes, archived, created_at, updated_at)
         VALUES (?, ?, 'Sample Contact', '+639175552000', 'sample@supplier.example', 'Baguio City',
           'Sample supplier record for demonstration.', 0, ?, ?)`,
        [spec.id, `Sample Supplier ${spec.id}`, nowIso, nowIso]
      );
    }

    // Customer feedback examples.
    const feedbackItems = [
      ['Bea L.', 'bea@example.com', 'Store feedback', 'The stall pages are easy to browse. It would be nice to see more colour photos for bags.', 'new'],
      ['Miguel R.', '+639181234567', 'Order question', 'Can I pick up a sample order at the market instead of delivery?', 'reviewed'],
      ['Grace T.', 'grace@example.com', 'Accessibility', 'Dark mode looks great. Please keep the text size comfortable on mobile.', 'resolved'],
      ['Sample Visitor', 'visitor@example.com', 'Sample feedback record', 'This is seeded demonstration feedback for the prototype, not a real customer message.', 'new'],
    ];
    feedbackItems.forEach((item, index) => {
      store.run(
        `INSERT INTO feedback(name, contact, subject, message, status, is_sample, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
        [...item, new Date(nowMs - (index + 1) * 5 * 3600000).toISOString()]
      );
    });

    // Owner notifications.
    const recentOrders = store.all(
      `SELECT code, customer_name FROM orders WHERE stall_id = 1 AND is_sample = 1 ORDER BY created_at DESC LIMIT 3`
    );
    for (const order of recentOrders.slice(0, 2)) {
      store.run(
        `INSERT INTO notifications(user_id, type, title, message, link, is_read, created_at)
         VALUES (?, 'order', 'Sample order received', ?, '/owner/#/orders', 0, ?)`,
        [ownerId, `${order.code} from ${order.customer_name} was added to your sample orders.`, nowIso]
      );
    }
    store.run(
      `INSERT INTO notifications(user_id, type, title, message, link, is_read, created_at)
       VALUES (?, 'review', 'New sample review', 'A demonstration customer review is waiting in your Reviews page.', '/owner/#/reviews', 0, ?)`,
      [ownerId, nowIso]
    );
    store.run(
      `INSERT INTO notifications(user_id, type, title, message, link, is_read, created_at)
       VALUES (?, 'stock', 'Low stock reminder', 'Three sample products are low in stock. Review them in Inventory.', '/owner/#/inventory', 1, ?)`,
      [ownerId, nowIso]
    );

    // Sample audit activity.
    SAMPLE_ACTIVITY.forEach((entry, index) => {
      const role = entry[0];
      const actorId = role === 'admin' ? adminId : role === 'operator' ? operatorId : ownerId;
      const actorName = role === 'admin' ? userRows.admin.name : role === 'operator' ? userRows.operator.name : userRows.owner.name;
      store.run(
        `INSERT INTO activity_logs(actor_id, actor_role, actor_name, action, entity_type, entity_id, details, ip, is_sample, created_at)
         VALUES (?, ?, ?, ?, 'demo', ?, ?, '127.0.0.1', 1, ?)`,
        [
          actorId, role, actorName, entry[2], `SAMPLE-${index + 1}`, entry[1],
          new Date(nowMs - (index + 1) * 5 * 3600000).toISOString(),
        ]
      );
    });


    // Requirement: no pre-existing Admin / Operator / Owner accounts.
    // Keep catalogue (stalls, products) but remove every seeded staff account and related sessions.
    store.run('DELETE FROM sessions');
    store.run('DELETE FROM notifications');
    store.run('DELETE FROM password_resets');
    store.run('DELETE FROM signup_codes');
    store.run('UPDATE tickets SET assigned_to = NULL, created_by = NULL');
    store.run('DELETE FROM visits');
    store.run('DELETE FROM activity_logs');
    store.run('DELETE FROM users');
    store.run("UPDATE stalls SET occupancy = 'available', updated_at = ?", [nowIso]);
    store.run("DELETE FROM sqlite_sequence WHERE name = 'users'");

    store.setSetting('demo_mode', '1');
    store.setSetting('promo_hint', 'SKY50');
    store.setSetting('prohibited_words', JSON.stringify(store.DEFAULT_PROHIBITED_WORDS));
    store.setSetting('review_filter_enabled', '1');
  });

  if (!quiet) {
    console.log('');
    console.log('SkyWorld catalogue ready.');
    console.log('  Stalls and products are seeded. No staff accounts are pre-created.');
    console.log('  Register the first administrator at /portal/admin/ (no email/SMS required for the first account).');
    console.log('  Additional Admin, Operator, and Owner accounts require a configured delivery provider.');
    console.log('');
  }
  return { seeded: true, counts: { stalls: STALL_SPECS.length, owners: 0 } };
}

function ensureSeeded() {
  const existing = store.get('SELECT COUNT(*) AS count FROM stalls');
  if (existing && existing.count > 0) return false;
  seedDatabase({ reset: false, quiet: false });
  return true;
}

module.exports = { seedDatabase, ensureSeeded, resetDatabase, STALL_SPECS, TEMPLATES };

if (require.main === module) {
  const reset = process.argv.includes('--reset');
  if (reset) {
    console.log('Resetting the SkyWorld demo database and regenerating sample data…');
  }
  seedDatabase({ reset, quiet: false });
  console.log('Seed complete.');
}
