/**
 * Phase 85A — the Wildwood Kitchen demo storefront (slug `demo-restaurant`), as data: the restaurant
 * profile, menu, and modifier groups the marketing site's live demo links to. Exported from the
 * final state scripts/seed-demo-data.ts produces locally (after all of its incremental backfills),
 * so production shows the same storefront development does. Images are the storefront's own static
 * files (apps/web/public/menu-images, /restaurant-images), not uploads — no object storage needed.
 *
 * Used ONLY by services/productionDemo.service.ts. Contains no accounts, orders, customers or
 * credentials — those stay dev-only in seed-demo-data.ts.
 */

export interface DemoCategory {
  name: string;
  sortOrder: number;
}

export interface DemoMenuItem {
  category: string;
  name: string;
  description?: string;
  price: number;
  imageUrl?: string;
  isAvailable: boolean;
  sortOrder: number;
}

export interface DemoModifierOption {
  name: string;
  priceAdjustment: number;
  isActive: boolean;
  sortOrder: number;
}

export interface DemoModifierGroup {
  item: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  isActive: boolean;
  sortOrder: number;
  options: DemoModifierOption[];
}

export const DEMO_RESTAURANT_PROFILE = {
  name: "Wildwood Kitchen",
  description:
    "A wood-fired kitchen for modern American comfort food — hearth-baked pizza, smash burgers, and a grill that never stops, in the heart of Springfield.",
  phone: "+1-555-0100",
  address: "1200 S 6th St",
  city: "Springfield",
  state: "IL",
  postalCode: "62703",
  country: "USA",
  latitude: 39.7817,
  longitude: -89.6501,
  coverImage: "/restaurant-images/demo-restaurant-cover.jpg",
  logo: "/restaurant-images/wildwood-kitchen-logo.svg",
  theme: {
    themeKey: "cinematic",
    themeVersion: 1,
    sections: {
      featured: true,
      about: true,
      gallery: true,
      cta: true,
    },
  },
} as const;

export const DEMO_CATEGORIES: DemoCategory[] = [
  {
    name: "Starters",
    sortOrder: 0,
  },
  {
    name: "Salads",
    sortOrder: 1,
  },
  {
    name: "Wood-Fired Pizza",
    sortOrder: 2,
  },
  {
    name: "Smash Burgers",
    sortOrder: 3,
  },
  {
    name: "From the Grill",
    sortOrder: 4,
  },
  {
    name: "Desserts",
    sortOrder: 5,
  },
  {
    name: "Drinks",
    sortOrder: 6,
  },
];

export const DEMO_MENU_ITEMS: DemoMenuItem[] = [
  {
    category: "Wood-Fired Pizza",
    name: "Margherita Pizza",
    description:
      "Wood-fired with San Marzano-style tomato sauce, fresh mozzarella, and torn basil — the one every pizzeria is judged by.",
    price: 12.5,
    imageUrl: "/menu-images/margherita-pizza.jpg",
    isAvailable: true,
    sortOrder: 0,
  },
  {
    category: "Smash Burgers",
    name: "Classic Burger",
    description:
      "A hand-pattied beef burger, sharp cheddar, crisp lettuce, vine tomato, and our own house sauce on a toasted bun.",
    price: 10.5,
    imageUrl: "/menu-images/classic-burger.jpg",
    isAvailable: true,
    sortOrder: 0,
  },
  {
    category: "Salads",
    name: "Caesar Salad",
    description:
      "Crisp romaine hearts, shaved parmesan, and garlic croutons tossed in a classic Caesar dressing.",
    price: 8.5,
    imageUrl: "/menu-images/caesar-salad.jpg",
    isAvailable: true,
    sortOrder: 0,
  },
  {
    category: "Starters",
    name: "Loaded Fries",
    description:
      "Hand-cut fries, smothered in melted cheese sauce, crisp bacon bits, and fresh scallions.",
    price: 7,
    imageUrl: "/menu-images/loaded-fries.jpg",
    isAvailable: true,
    sortOrder: 0,
  },
  {
    category: "Desserts",
    name: "Tiramisu",
    description:
      "Espresso-soaked ladyfingers layered with mascarpone cream and a dusting of cocoa — made fresh in house.",
    price: 6,
    imageUrl: "/menu-images/tiramisu.jpg",
    isAvailable: true,
    sortOrder: 0,
  },
  {
    category: "Drinks",
    name: "Coke",
    description: "330ml can",
    price: 2,
    imageUrl: "/menu-images/coke.jpg",
    isAvailable: true,
    sortOrder: 0,
  },
  {
    category: "From the Grill",
    name: "Herb-Roasted Half Chicken",
    description:
      "Slow-roasted half chicken with pan jus and fresh herbs, served with your choice of side.",
    price: 17.5,
    imageUrl: "/menu-images/herb-roasted-half-chicken.jpg",
    isAvailable: true,
    sortOrder: 0,
  },
  {
    category: "Wood-Fired Pizza",
    name: "Pepperoni Pizza",
    description:
      "A generous layer of cupped, crisp-edged pepperoni over our classic red sauce and mozzarella.",
    price: 14,
    imageUrl: "/menu-images/pepperoni-pizza.jpg",
    isAvailable: true,
    sortOrder: 1,
  },
  {
    category: "Smash Burgers",
    name: "Crispy Chicken Burger",
    description:
      "Buttermilk-marinated chicken, fried to order, with crunchy pickles, slaw, and a spicy mayo with a real kick.",
    price: 11,
    imageUrl: "/menu-images/crispy-chicken-burger.jpg",
    isAvailable: true,
    sortOrder: 1,
  },
  {
    category: "Desserts",
    name: "Chocolate Cake",
    description:
      "Three layers of dark chocolate cake with a silky chocolate ganache — rich, but never too sweet.",
    price: 6.5,
    imageUrl: "/menu-images/chocolate-cake.jpg",
    isAvailable: true,
    sortOrder: 1,
  },
  {
    category: "Starters",
    name: "Charred Shishito Peppers",
    description: "Blistered in the wood oven and tossed with flaky sea salt and fresh lime.",
    price: 9.5,
    imageUrl: "/menu-images/charred-shishito-peppers.jpg",
    isAvailable: true,
    sortOrder: 1,
  },
  {
    category: "Salads",
    name: "Grilled Peach & Burrata Salad",
    description: "Grilled peaches, creamy burrata, arugula, and a basil-balsamic drizzle.",
    price: 12,
    isAvailable: true,
    sortOrder: 1,
  },
  {
    category: "From the Grill",
    name: "Grilled Salmon",
    description: "Grilled Atlantic salmon over wilted greens, finished with your choice of sauce.",
    price: 18.5,
    imageUrl: "/menu-images/grilled-salmon.jpg",
    isAvailable: true,
    sortOrder: 1,
  },
  {
    category: "Drinks",
    name: "Sparkling Lemonade",
    description: "House-made lemonade with a splash of soda, over ice.",
    price: 3.5,
    isAvailable: true,
    sortOrder: 1,
  },
  {
    category: "Wood-Fired Pizza",
    name: "BBQ Chicken Pizza",
    description:
      "Smoky house BBQ sauce, grilled chicken, thin-sliced red onion, and melted mozzarella, finished under the wood-fire.",
    price: 15.5,
    imageUrl: "/menu-images/bbq-chicken-pizza.jpg",
    isAvailable: true,
    sortOrder: 2,
  },
  {
    category: "Starters",
    name: "Crispy Buffalo Cauliflower",
    description: "Tossed in classic buffalo sauce, served with cool ranch for dipping.",
    price: 10,
    imageUrl: "/menu-images/crispy-buffalo-cauliflower.jpg",
    isAvailable: true,
    sortOrder: 2,
  },
  {
    category: "Salads",
    name: "Roasted Beet & Citrus Salad",
    description: "Roasted beets, segmented citrus, goat cheese, and toasted walnuts over greens.",
    price: 11.5,
    imageUrl: "/menu-images/roasted-beet-citrus-salad.jpg",
    isAvailable: true,
    sortOrder: 2,
  },
  {
    category: "Smash Burgers",
    name: "Mushroom Swiss Smash",
    description: "Two smashed patties, melted swiss, sautéed mushrooms, and garlic aioli.",
    price: 12.5,
    imageUrl: "/menu-images/mushroom-swiss-smash.jpg",
    isAvailable: true,
    sortOrder: 2,
  },
  {
    category: "From the Grill",
    name: "Braised Short Rib",
    description: "Red-wine braised short rib with creamy polenta and gremolata.",
    price: 21,
    imageUrl: "/menu-images/braised-short-rib.jpg",
    isAvailable: true,
    sortOrder: 2,
  },
  {
    category: "Desserts",
    name: "Salted Caramel Budino",
    description: "Silky salted caramel pudding, whipped cream, and a shard of toffee.",
    price: 7,
    imageUrl: "/menu-images/salted-caramel-budino.jpg",
    isAvailable: true,
    sortOrder: 2,
  },
  {
    category: "Drinks",
    name: "Iced Tea",
    description: "Fresh-brewed and lightly sweetened, served over ice.",
    price: 3,
    imageUrl: "/menu-images/iced-tea.jpg",
    isAvailable: true,
    sortOrder: 2,
  },
  {
    category: "Starters",
    name: "Whipped Ricotta & Grilled Bread",
    description:
      "House-whipped ricotta, hot honey, and cracked pepper, with grilled sourdough for scooping.",
    price: 9,
    imageUrl: "/menu-images/whipped-ricotta-grilled-bread.jpg",
    isAvailable: true,
    sortOrder: 3,
  },
  {
    category: "Wood-Fired Pizza",
    name: "Wild Mushroom & Taleggio Pizza",
    description: "Roasted wild mushrooms, taleggio, and fresh thyme over a garlic cream base.",
    price: 16,
    imageUrl: "/menu-images/wild-mushroom-taleggio-pizza.jpg",
    isAvailable: true,
    sortOrder: 3,
  },
  {
    category: "Smash Burgers",
    name: "Fried Green Tomato BLT",
    description:
      "Cornmeal-crusted green tomatoes, crisp bacon, lettuce, and remoulade on toasted brioche.",
    price: 11.5,
    imageUrl: "/menu-images/fried-green-tomato-blt.jpg",
    isAvailable: true,
    sortOrder: 3,
  },
  {
    category: "From the Grill",
    name: "Grilled Vegetable Plate",
    description:
      "Seasonal vegetables charred over the open flame, finished with herb oil and flaky salt.",
    price: 13,
    imageUrl: "/menu-images/grilled-vegetable-plate.jpg",
    isAvailable: true,
    sortOrder: 3,
  },
  {
    category: "Drinks",
    name: "Root Beer Float",
    description: "Classic root beer over vanilla soft-serve.",
    price: 5,
    imageUrl: "/menu-images/root-beer-float.jpg",
    isAvailable: true,
    sortOrder: 3,
  },
  {
    category: "Wood-Fired Pizza",
    name: "Spicy Soppressata Pizza",
    description:
      "Spicy soppressata and mozzarella with calabrian chili honey, finished with fresh basil.",
    price: 16.5,
    imageUrl: "/menu-images/spicy-soppressata-pizza.jpg",
    isAvailable: true,
    sortOrder: 4,
  },
  {
    category: "Drinks",
    name: "San Pellegrino Sparkling Water",
    description: "330ml bottle.",
    price: 3,
    isAvailable: true,
    sortOrder: 4,
  },
];

export const DEMO_MODIFIER_GROUPS: DemoModifierGroup[] = [
  {
    item: "Margherita Pizza",
    name: "Size",
    minSelect: 1,
    maxSelect: 1,
    isActive: true,
    sortOrder: 0,
    options: [
      {
        name: "Small",
        priceAdjustment: 0,
        isActive: true,
        sortOrder: 0,
      },
      {
        name: "Medium",
        priceAdjustment: 2,
        isActive: true,
        sortOrder: 1,
      },
      {
        name: "Large",
        priceAdjustment: 4,
        isActive: true,
        sortOrder: 2,
      },
    ],
  },
  {
    item: "Pepperoni Pizza",
    name: "Size",
    minSelect: 1,
    maxSelect: 1,
    isActive: true,
    sortOrder: 0,
    options: [
      {
        name: "Small",
        priceAdjustment: 0,
        isActive: true,
        sortOrder: 0,
      },
      {
        name: "Medium",
        priceAdjustment: 2,
        isActive: true,
        sortOrder: 1,
      },
      {
        name: "Large",
        priceAdjustment: 4,
        isActive: true,
        sortOrder: 2,
      },
    ],
  },
  {
    item: "Classic Burger",
    name: "Add-ons",
    minSelect: 0,
    maxSelect: 3,
    isActive: true,
    sortOrder: 0,
    options: [
      {
        name: "Extra patty",
        priceAdjustment: 3,
        isActive: true,
        sortOrder: 0,
      },
      {
        name: "Extra cheese",
        priceAdjustment: 1,
        isActive: true,
        sortOrder: 1,
      },
      {
        name: "Bacon",
        priceAdjustment: 2,
        isActive: true,
        sortOrder: 2,
      },
    ],
  },
  {
    item: "Coke",
    name: "Size",
    minSelect: 1,
    maxSelect: 1,
    isActive: true,
    sortOrder: 0,
    options: [
      {
        name: "Regular",
        priceAdjustment: 0,
        isActive: true,
        sortOrder: 0,
      },
      {
        name: "Large",
        priceAdjustment: 1,
        isActive: true,
        sortOrder: 1,
      },
    ],
  },
  {
    item: "BBQ Chicken Pizza",
    name: "Size",
    minSelect: 1,
    maxSelect: 1,
    isActive: true,
    sortOrder: 0,
    options: [
      {
        name: "Small",
        priceAdjustment: 0,
        isActive: true,
        sortOrder: 0,
      },
      {
        name: "Medium",
        priceAdjustment: 2,
        isActive: true,
        sortOrder: 1,
      },
      {
        name: "Large",
        priceAdjustment: 4,
        isActive: true,
        sortOrder: 2,
      },
    ],
  },
  {
    item: "Wild Mushroom & Taleggio Pizza",
    name: "Size",
    minSelect: 1,
    maxSelect: 1,
    isActive: true,
    sortOrder: 0,
    options: [
      {
        name: "Small",
        priceAdjustment: 0,
        isActive: true,
        sortOrder: 0,
      },
      {
        name: "Medium",
        priceAdjustment: 2,
        isActive: true,
        sortOrder: 1,
      },
      {
        name: "Large",
        priceAdjustment: 4,
        isActive: true,
        sortOrder: 2,
      },
    ],
  },
  {
    item: "Crispy Chicken Burger",
    name: "Add-ons",
    minSelect: 0,
    maxSelect: 3,
    isActive: true,
    sortOrder: 0,
    options: [
      {
        name: "Bacon",
        priceAdjustment: 2,
        isActive: true,
        sortOrder: 0,
      },
      {
        name: "Extra cheese",
        priceAdjustment: 1,
        isActive: true,
        sortOrder: 1,
      },
      {
        name: "Avocado",
        priceAdjustment: 1.5,
        isActive: true,
        sortOrder: 2,
      },
    ],
  },
  {
    item: "Herb-Roasted Half Chicken",
    name: "Choice of side",
    minSelect: 1,
    maxSelect: 1,
    isActive: true,
    sortOrder: 0,
    options: [
      {
        name: "Garlic mashed potatoes",
        priceAdjustment: 0,
        isActive: true,
        sortOrder: 0,
      },
      {
        name: "Wild rice pilaf",
        priceAdjustment: 0,
        isActive: true,
        sortOrder: 1,
      },
      {
        name: "Grilled seasonal vegetables",
        priceAdjustment: 0,
        isActive: true,
        sortOrder: 2,
      },
    ],
  },
  {
    item: "Grilled Salmon",
    name: "Sauce",
    minSelect: 1,
    maxSelect: 1,
    isActive: true,
    sortOrder: 0,
    options: [
      {
        name: "Lemon-butter beurre blanc",
        priceAdjustment: 0,
        isActive: true,
        sortOrder: 0,
      },
      {
        name: "Charred chimichurri",
        priceAdjustment: 0,
        isActive: true,
        sortOrder: 1,
      },
    ],
  },
  {
    item: "Iced Tea",
    name: "Size",
    minSelect: 1,
    maxSelect: 1,
    isActive: true,
    sortOrder: 0,
    options: [
      {
        name: "Regular",
        priceAdjustment: 0,
        isActive: true,
        sortOrder: 0,
      },
      {
        name: "Large",
        priceAdjustment: 1,
        isActive: true,
        sortOrder: 1,
      },
    ],
  },
  {
    item: "Margherita Pizza",
    name: "Extra toppings",
    minSelect: 0,
    maxSelect: 3,
    isActive: true,
    sortOrder: 1,
    options: [
      {
        name: "Extra cheese",
        priceAdjustment: 1.5,
        isActive: true,
        sortOrder: 0,
      },
      {
        name: "Mushrooms",
        priceAdjustment: 1,
        isActive: true,
        sortOrder: 1,
      },
      {
        name: "Olives",
        priceAdjustment: 1,
        isActive: true,
        sortOrder: 2,
      },
    ],
  },
];
