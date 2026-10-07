// Scripted buyers for the synthetic mobile set. Used by determinism, simulate and explainer tests.
// Each entry: [title, answers, profile overrides].
export const PERSONAS = [
  ['Student, 12k cash, social + heavy gaming', { who: 'me', use: ['social', 'gaming'], gameLevel: 'heavy', pain: ['slow'], pay: 'cash', budget: 12000 }, {}],
  ['Creator, 18k cash, night shots', { who: 'me', use: ['photo', 'social'], photoType: ['night'], pain: ['camera'], pay: 'cash', budget: 18000 }, {}],
  ['For my mother, 12k cash', { who: 'parent', parentUse: 'more', pay: 'cash', budget: 12000 }, {}],
  ['Exec, 60k cash, iPhone only', { who: 'me', use: ['work', 'photo'], photoType: ['people'], os: 'ios', pay: 'cash', budget: 60000 }, {}],
  ['Nothing stated', {}, {}],
  ['Mona: photo, finance 1,500/month', { who: 'me', use: ['photo'], pay: 'finance', monthlyCap: 1500, city: 'cairo' }, { modelInMind: 'Galaxy A56' }],
  ['Finance 2,500/month, 5k down, Sahla only', { use: ['photo', 'social'], pay: 'finance', monthlyCap: 2500, down: 5000, provider: 'sahla' }, { modelInMind: 'iphone 15' }],
  ['Student, 500/month', { use: ['social'], pay: 'finance', monthlyCap: 500 }, { modelInMind: 'samsung-a16' }],
  ['Card 3,000/month, Horus Bank', { use: ['gaming'], gameLevel: 'light', pay: 'card', monthlyCap: 3000, provider: 'horusbank' }, {}],
  ['Alexandria, COD only, 20k', { use: ['social'], pay: 'cash', budget: 20000, city: 'alexandria', cod: 'must' }, {}],
  ['Urgent, Cairo, 15k', { use: ['work'], pay: 'cash', budget: 15000, city: 'cairo', urgentDays: 'today' }, {}],
  ['Accepts imports, 40k', { use: ['photo'], pay: 'cash', budget: 40000, acceptImports: 'yes' }, {}],
  ['Avoids two shops, likes one', { use: ['social'], pay: 'cash', budget: 25000, shops: { prefer: ['lotus'], avoid: ['khan', 'delta'] } }, {}],
  ['Galaxy Watch owner, 30k', { use: ['social'], compat: ['galaxy_watch'], pay: 'cash', budget: 30000 }, {}],
  ['Keeps it 2 years, 50k', { use: ['photo'], keep: 'short', pay: 'cash', budget: 50000 }, {}],
  ['Storage 512, 30k (nothing fits)', { storageNeed: 's512', pay: 'cash', budget: 30000 }, {}],
  ['Brand tiebreak Samsung, 20k', { use: ['social'], brand: ['samsung'], pay: 'cash', budget: 20000 }, {}],
  ['Avoid Xiaomi, finance 1,000', { use: ['social'], brandAvoid: ['xiaomi'], pay: 'finance', monthlyCap: 1000 }, {}],
];
