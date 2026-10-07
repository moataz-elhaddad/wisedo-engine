// Category configs and the synthetic sample data, bundled into the Worker (JSON imports).
import mobile from '../config/mobile.json' with { type: 'json' };
import laptop from '../config/laptop.json' with { type: 'json' };
import tv from '../config/tv.json' with { type: 'json' };
import ac from '../config/ac.json' with { type: 'json' };
import fridge from '../config/fridge.json' with { type: 'json' };
import manifest from '../data/synthetic/manifest.json' with { type: 'json' };
import retailers from '../data/synthetic/retailers.json' with { type: 'json' };
import plans from '../data/synthetic/plans.json' with { type: 'json' };
import mobileProducts from '../data/synthetic/products.json' with { type: 'json' };
import mobileOffers from '../data/synthetic/offers.json' with { type: 'json' };
import laptopProducts from '../data/synthetic/laptop/products.json' with { type: 'json' };
import laptopOffers from '../data/synthetic/laptop/offers.json' with { type: 'json' };
import tvProducts from '../data/synthetic/tv/products.json' with { type: 'json' };
import tvOffers from '../data/synthetic/tv/offers.json' with { type: 'json' };
import acProducts from '../data/synthetic/ac/products.json' with { type: 'json' };
import acOffers from '../data/synthetic/ac/offers.json' with { type: 'json' };
import fridgeProducts from '../data/synthetic/fridge/products.json' with { type: 'json' };
import fridgeOffers from '../data/synthetic/fridge/offers.json' with { type: 'json' };

export const CONFIGS = { mobile, laptop, tv, ac, fridge };

/** The sample data's own clock; every synthetic category shares it. */
export const SEED_NOW = manifest.now;

export const SEED = {
  retailers,
  plans,
  products: [...mobileProducts, ...laptopProducts, ...tvProducts, ...acProducts, ...fridgeProducts],
  offers: [...mobileOffers, ...laptopOffers, ...tvOffers, ...acOffers, ...fridgeOffers],
};
