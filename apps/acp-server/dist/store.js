function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}
export function nowIso() {
    return new Date().toISOString();
}
export function createId(store, prefix) {
    const current = store.counters[prefix] ?? 0;
    const next = current + 1;
    store.counters[prefix] = next;
    return `${prefix}_${String(next).padStart(6, "0")}`;
}
const seedProducts = [
    {
        id: "prod_classic_tee",
        title: "Classic Tee",
        variants: [
            {
                id: "sku123-red-s",
                title: "Classic Tee - Red / Small",
                price: { amount: 1999, currency: "USD" },
                availability: { available: true, status: "in_stock" }
            }
        ]
    },
    {
        id: "prod_running_shoes",
        title: "Blue Running Shoes",
        variants: [
            {
                id: "item_123",
                title: "Blue Running Shoes",
                price: { amount: 12000, currency: "USD" },
                availability: { available: true, status: "in_stock" }
            }
        ]
    },
    {
        id: "prod_athletic_socks",
        title: "Athletic Socks (3-pack)",
        variants: [
            {
                id: "item_456",
                title: "Athletic Socks (3-pack)",
                price: { amount: 1500, currency: "USD" },
                availability: { available: true, status: "in_stock" }
            }
        ]
    }
];
function buildSeedCatalog() {
    const catalog = new Map();
    catalog.set("item_123", { name: "Blue Running Shoes", unit_amount: 12000 });
    catalog.set("item_456", { name: "Athletic Socks (3-pack)", unit_amount: 1500 });
    catalog.set("item_789", { name: "Wireless Headphones", unit_amount: 7999 });
    catalog.set("prod_classic_tee", { name: "Classic Tee", unit_amount: 1999 });
    catalog.set("sku123-red-s", { name: "Classic Tee - Red / Small", unit_amount: 1999 });
    return catalog;
}
export function createStore() {
    const store = {
        counters: {},
        checkoutSessions: new Map(),
        carts: new Map(),
        feeds: new Map(),
        authenticationSessions: new Map(),
        webhookEvents: [],
        catalog: buildSeedCatalog()
    };
    const seedFeedId = "feed_seed";
    store.feeds.set(seedFeedId, {
        metadata: {
            id: seedFeedId,
            target_country: "US",
            updated_at: nowIso()
        },
        products: deepClone(seedProducts)
    });
    return store;
}
export function snapshot(value) {
    return deepClone(value);
}
