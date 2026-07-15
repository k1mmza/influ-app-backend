// Throwaway tester for the smart-search prompt. Run from influ-app-backend:
//   node test-smart-search.mjs
//   node test-smart-search.mjs "your own query here"
// Mirrors SmartSearchService.parseQuery exactly (system prompt + '{' prefill).
import 'dotenv/config';

const SYSTEM = `You convert a natural-language influencer-search query into a JSON filter object.
Return ONLY the raw JSON object — no markdown, no code fences, no prose.

Rules:
- The query may be in Thai, English, or any language, or a mix. Interpret its MEANING regardless of language. All enum values below and the "country" value MUST be output in English (e.g. a Thai travel query → categories:["Travel"], "ประเทศไทย" → country:"Thailand"). The ONE exception is "keyword": copy proper names (brands, products, creators) VERBATIM as the user wrote them — never translate or transliterate them.
- Output only fields the query clearly and explicitly states. If you are unsure about a field, OMIT it. Never guess, never fill in defaults, never infer a filter the user did not ask for. Fewer correct fields beat more speculative ones.
- Use ONLY the field names and allowed values listed below. Never invent a field name or a value outside the allowed set. If a requested value is not in an allowed set, omit that field.
- Enum values are case-sensitive: copy them EXACTLY as written.
- Return {} if nothing maps.

Fields:
- platforms: string[] — subset of exactly: ["tiktok","instagram","youtube","facebook","x","lemon8"]. Lowercase. Map "twitter"/"X"/"ทวิตเตอร์" → "x". If the user names any platform NOT in this list (e.g. LinkedIn, Snapchat, Pinterest, Threads, Twitch), OMIT it entirely — never include it and never substitute a similar one.
- categories: string[], max 3 — subset of exactly: Beauty, Fashion, Fitness, Food, Gaming, Travel, Tech, Lifestyle, Education, Entertainment, Business, Music, Sports, Comedy, DIY, Cooking, Health. Always an array, even for one: ["Travel"].
- followerRange: one of exactly "Nano" | "Micro" | "Mid" | "Macro" | "Mega" (case-sensitive). ONLY when the user names a tier ("micro influencer", "macro creator"). Do NOT use it for numeric thresholds like "over 500k" — use minFollowers for those. Never both.
- minFollowers: integer — for "over X", "at least X", "more than X followers". Expand shorthand: "1M"/"1 million" → 1000000, "10k" → 10000.
- minAverageViews: integer.
- minEngagementRate: number — percentage as a plain number ("at least 3.5%" → 3.5).
- minGrowthRate: number — percentage as a plain number.
- minQualityScore: number 0-100.
- minPerformanceScore: number 0-100.
- maxRatePerPost: integer — max price per post in THB.
- minResponseRate: number 0-100.
- audienceGender: one of exactly "Male" | "Female" | "Mixed".
- audienceAgeGroup: one of exactly "18-24" | "25-34" | "35-44" | "45+" (case- and format-exact). "teen"/"teenage" → "18-24".
- country: string.
- stylePresent: one of exactly: Short Story, Storytelling, Experiment, Tutorial, Review, Vlog.
- keyword: string — ONLY a specific brand, product, or creator name explicitly named. NEVER put leftover, unmatched, or arbitrary query text here. If the query is gibberish, a greeting, or has no recognizable filter criteria, return {} — do not salvage it into keyword.

Examples:
Query: "micro travel influencers on tiktok in thailand"
{"platforms":["tiktok"],"categories":["Travel"],"followerRange":"Micro","country":"Thailand"}

Query: "youtube gaming creators with over 1 million followers and 5% engagement"
{"platforms":["youtube"],"categories":["Gaming"],"minFollowers":1000000,"minEngagementRate":5}

Query: "female beauty creators aged 18-24 who do product reviews under 20000 baht per post"
{"categories":["Beauty"],"audienceGender":"Female","audienceAgeGroup":"18-24","stylePresent":"Review","maxRatePerPost":20000}

Query (Thai): "อินฟลูสายอาหารในไอจี มีผู้ติดตามมากกว่า 50000 คน"
{"platforms":["instagram"],"categories":["Food"],"minFollowers":50000}

Query: "influencers on linkedin"
{}

Query: "asdfgh hello random text 12345"
{}`;

async function parseQuery(query) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 256,
      temperature: 0,
      stop_sequences: ['}'],
      system: SYSTEM,
      messages: [
        { role: 'user', content: `Parse this search query into filters: "${query}"` },
        { role: 'assistant', content: '{' },
      ],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  const completion = data.content?.[0]?.text ?? '';
  return JSON.parse(`{${completion}}`);
}

const SUPPORTED = ['tiktok', 'instagram', 'youtube', 'facebook', 'x', 'lemon8'];
const inc = (a, v) => Array.isArray(a) && a.includes(v);
const nkeys = (r) => Object.keys(r).length;

// [label, query, assertion(result) -> string|null (null = pass)]
const cases = [
  // 1. Tier keyword must come back exact-cased ("Micro", not "micro")
  ['tier casing', 'micro beauty influencers on instagram',
    (r) => r.followerRange === 'Micro' && inc(r.categories, 'Beauty') && inc(r.platforms, 'instagram')
      ? null : `expected followerRange:"Micro" + Beauty + instagram`],

  // 2. Numeric threshold → minFollowers, NOT followerRange
  ['numeric vs tier', 'gaming youtubers with at least 500k followers',
    (r) => r.minFollowers === 500000 && r.followerRange === undefined && inc(r.categories, 'Gaming') && inc(r.platforms, 'youtube')
      ? null : `expected minFollowers:500000, no followerRange, Gaming, youtube`],

  // 3. Mixed English + Thai in one query
  ['mixed EN+TH', 'food creators สายกิน on tiktok ที่ engagement เกิน 5%',
    (r) => inc(r.categories, 'Food') && inc(r.platforms, 'tiktok') && r.minEngagementRate === 5
      ? null : `expected Food + tiktok + minEngagementRate:5`],

  // 4. Full Thai incl. tier word — must normalize to English enums
  ['full Thai + tier', 'อยากได้ macro influencer สายแฟชั่นในไอจี',
    (r) => r.followerRange === 'Macro' && inc(r.categories, 'Fashion') && inc(r.platforms, 'instagram')
      ? null : `expected Macro + Fashion + instagram from Thai`],

  // 5. Misspelled / spaced platform names
  ['platform typos', 'travel influencers on tik tok and instgram',
    (r) => inc(r.platforms, 'tiktok') && inc(r.platforms, 'instagram')
      ? null : `expected tiktok + instagram despite typos, got ${JSON.stringify(r.platforms)}`],

  // 6. Misspelled category names
  ['category typos', 'fashon and beuty creators',
    (r) => inc(r.categories, 'Fashion') && inc(r.categories, 'Beauty')
      ? null : `expected Fashion + Beauty despite typos, got ${JSON.stringify(r.categories)}`],

  // 7. Unsupported platform — must not be substituted with a supported one
  ['unsupported platform', 'b2b marketers on linkedin',
    (r) => !(r.platforms || []).some((p) => SUPPORTED.includes(p))
      ? null : `linkedin must not map to a supported platform, got ${JSON.stringify(r.platforms)}`],

  // 8. "twitter" → "x"
  ['twitter → x', 'tech influencers on twitter over 100k followers',
    (r) => inc(r.platforms, 'x') && !inc(r.platforms, 'twitter') && r.minFollowers === 100000 && inc(r.categories, 'Tech')
      ? null : `expected x (not twitter) + minFollowers:100000 + Tech`],

  // 9. Audience demographics — exact-format age bucket + gender
  ['audience demo', 'fitness creators with a mostly female audience aged 18-24',
    (r) => inc(r.categories, 'Fitness') && r.audienceGender === 'Female' && r.audienceAgeGroup === '18-24'
      ? null : `expected Fitness + audienceGender:"Female" + audienceAgeGroup:"18-24"`],

  // 10. Style + rate card
  ['style + rate', 'creators who do tutorials under 15000 baht per post',
    (r) => r.stylePresent === 'Tutorial' && r.maxRatePerPost === 15000
      ? null : `expected stylePresent:"Tutorial" + maxRatePerPost:15000`],

  // 11. Too many categories — capped at 3
  ['category cap', 'travel food beauty fashion tech gaming influencers',
    (r) => (r.categories || []).length > 0 && (r.categories || []).length <= 3
      ? null : `expected 1-3 categories, got ${JSON.stringify(r.categories)}`],

  // 12. Nonsense / no filters → empty object
  ['nonsense → {}', 'asdfgh hello random text 12345',
    (r) => nkeys(r) === 0 ? null : `expected {} for nonsense, got ${JSON.stringify(r)}`],

  // 13-15. Categories/styles that only exist in the full CATEGORY_TAGS/STYLE_TAGS
  // list — would have failed under the old hardcoded 9-category / 5-style prompt.
  ['category beyond old-9', 'cooking creators on youtube',
    (r) => inc(r.categories, 'Cooking') && inc(r.platforms, 'youtube')
      ? null : `expected Cooking + youtube, got ${JSON.stringify(r)}`],

  ['category sports', 'sports influencers with over 200k followers',
    (r) => inc(r.categories, 'Sports') && r.minFollowers === 200000
      ? null : `expected Sports + minFollowers:200000, got ${JSON.stringify(r)}`],

  ['style short story', 'creators who post short story style videos',
    (r) => r.stylePresent === 'Short Story'
      ? null : `expected stylePresent:"Short Story", got ${JSON.stringify(r.stylePresent)}`],
];

const custom = process.argv.slice(2).join(' ').trim();
const run = custom ? [['custom', custom, () => null]] : cases;

let passed = 0;
for (const [label, q, assert] of run) {
  try {
    const r = await parseQuery(q);
    const fail = assert(r);
    if (!fail) passed++;
    console.log(`${fail ? '❌' : '✅'}  [${label}] ${q}`);
    console.log(`     ${JSON.stringify(r)}`);
    if (fail) console.log(`     ↳ ${fail}`);
  } catch (e) {
    console.log(`💥  [${label}] ${q}\n     ${e.message}`);
  }
}
if (!custom) console.log(`\n${passed}/${run.length} passed`);
