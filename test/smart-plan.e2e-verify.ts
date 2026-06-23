/**
 * End-to-end verification for the Smart Plan feature.
 * Real HTTP against :3001 + real DB reads (Prisma). The /generate path hits the
 * live Anthropic API (ANTHROPIC_API_KEY is set) — kept to 2 haiku calls.
 * NOT product code. Run: npx ts-node --transpile-only test/smart-plan.e2e-verify.ts
 */
import { PrismaClient } from '@prisma/client';

const API = 'http://localhost:3001';
const prisma = new PrismaClient();

type Check = { id: string; name: string; pass: boolean; evidence: string };
const checks: Check[] = [];
function record(id: string, name: string, pass: boolean, evidence: string) {
  checks.push({ id, name, pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${id}] ${name}\n        ${evidence}`);
}

async function http(method: string, path: string, token?: string, body?: any) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, json };
}

async function tokenFor(name: string, email: string, role: string) {
  await http('POST', '/auth/register', undefined, { name, email, password: 'Test1234!' });
  const login = await http('POST', '/auth/login', undefined, { email, password: 'Test1234!' });
  const token = login.json?.access_token;
  if (!token) throw new Error(`no token for ${email}: ${JSON.stringify(login.json)}`);
  if (!login.json.user.isRoleSelected) await http('POST', '/auth/select-role', token, { role });
  return { token, userId: login.json.user.id };
}

const DATE_FIELDS = ['applyDeadline', 'submissionDate', 'reviewDate', 'paymentDate'];

async function main() {
  const stamp = Date.now();
  console.log(`\n=== Smart Plan E2E verification @ ${new Date().toISOString()} ===\n`);

  const brand = await tokenFor('SP Brand', `sp.brand.${stamp}@influapp.test`, 'BRAND');
  const inf = await tokenFor('SP Inf', `sp.inf.${stamp}@influapp.test`, 'INFLUENCER');

  // ── Role guards: INFLUENCER forbidden on every smart-plan route ──
  const gInf = await http('POST', '/smart-plan/generate', inf.token, { campaignName: 'x' });
  const sInf = await http('POST', '/smart-plan/save', inf.token, { strategy: 'x' });
  const bInf = await http('GET', '/smart-plan/brief', inf.token);
  const cInf = await http('POST', '/smart-plan/create-campaign', inf.token, { campaignFields: { name: 'x' } });
  record(
    'G1',
    'INFLUENCER is forbidden (403) on generate/save/brief/create-campaign',
    gInf.status === 403 && sInf.status === 403 && bInf.status === 403 && cInf.status === 403,
    `generate=${gInf.status} save=${sInf.status} brief=${bInf.status} create=${cInf.status}`,
  );

  // ── Validation: create-campaign requires a campaignFields object ──
  const badCreate = await http('POST', '/smart-plan/create-campaign', brand.token, { strategy: 'no fields' });
  record(
    'V1',
    'create-campaign without campaignFields object -> 400',
    badCreate.status === 400,
    `status=${badCreate.status} -> ${JSON.stringify(badCreate.json?.message)}`,
  );

  // ── generate (structured form) — real AI ──
  const formGen = await http('POST', '/smart-plan/generate', brand.token, {
    campaignName: `Summer Glow ${stamp}`,
    objective: 'Awareness',
    productInfo: 'A vegan SPF50 sunscreen for sensitive skin',
    budget: '50000',
    doDont: 'No medical claims',
  });
  const fg = formGen.json ?? {};
  const cf = fg.campaignFields ?? {};
  const datesAbsent = DATE_FIELDS.every((d) => cf[d] === undefined); // stripNulls removes the forced nulls
  const shapeOk =
    (formGen.status === 200 || formGen.status === 201) &&
    typeof fg.strategy === 'string' && fg.strategy.length > 0 &&
    typeof fg.concept === 'string' && fg.concept.length > 0 &&
    typeof fg.briefBody === 'string' && fg.briefBody.length > 0 &&
    typeof cf.name === 'string' && cf.name.trim().length > 0;
  record(
    'GEN1',
    'generate (form): valid brief + non-empty campaignFields.name + dates forced null/absent',
    shapeOk && datesAbsent,
    `status=${formGen.status} name=${JSON.stringify(cf.name)} strategy.len=${fg.strategy?.length} datesAbsent=${datesAbsent}`,
  );
  record(
    'GEN2',
    'generate (form): provenance marks user-provided "name" (campaignName) as userProvided',
    Array.isArray(fg.provenance?.userProvided) && fg.provenance.userProvided.includes('name'),
    `userProvided=${JSON.stringify(fg.provenance?.userProvided)} aiSuggested=${JSON.stringify(fg.provenance?.aiSuggested)}`,
  );

  // ── generate (rawPrompt) — real AI; everything is AI-suggested ──
  const promptGen = await http('POST', '/smart-plan/generate', brand.token, {
    rawPrompt: 'Launch a budget-friendly iced-coffee brand to Gen Z in Bangkok via TikTok creators.',
  });
  const pg = promptGen.json ?? {};
  record(
    'GEN3',
    'generate (rawPrompt): valid shape; provenance.userProvided is empty (all AI)',
    (promptGen.status === 200 || promptGen.status === 201) &&
      typeof pg.strategy === 'string' && pg.strategy.length > 0 &&
      typeof pg.campaignFields?.name === 'string' && pg.campaignFields.name.length > 0 &&
      Array.isArray(pg.provenance?.userProvided) && pg.provenance.userProvided.length === 0,
    `status=${promptGen.status} name=${JSON.stringify(pg.campaignFields?.name)} userProvided=${JSON.stringify(pg.provenance?.userProvided)}`,
  );

  // ── save standalone brief -> restore via GET /brief ──
  const strat = `S-${stamp}`;
  const saveStandalone = await http('POST', '/smart-plan/save', brand.token, {
    strategy: strat, concept: 'C', briefBody: 'B',
  });
  const restore = await http('GET', '/smart-plan/brief', brand.token);
  record(
    'SAVE1',
    'save standalone brief -> GET /brief restores it',
    (saveStandalone.status === 200 || saveStandalone.status === 201) && restore.json?.strategy === strat,
    `saved.id=${saveStandalone.json?.id} restored.strategy=${JSON.stringify(restore.json?.strategy)}`,
  );

  // ── create-campaign from plan -> DRAFT campaign + attached brief (DB evidence) ──
  const createFromPlan = await http('POST', '/smart-plan/create-campaign', brand.token, {
    campaignFields: {
      name: `Plan Campaign ${stamp}`,
      objective: 'Conversion',
      budget: 30000,
      keyMessage: 'Glow all summer',
      deliverables: '1 Reel + 3 Stories',
      doAndDont: 'DO be authentic. DON\'T overclaim.',
      requirements: { minFollowers: 5000, platforms: ['tiktok'], categories: ['beauty'] },
    },
    strategy: 'plan-strategy', concept: 'plan-concept', briefBody: 'plan-brief',
  });
  const newCampaignId = createFromPlan.json?.campaignId;
  const campaignRow = newCampaignId
    ? await prisma.campaign.findUnique({ where: { id: newCampaignId }, include: { requirements: true } })
    : null;
  const briefRow = newCampaignId
    ? await prisma.smartPlanBrief.findFirst({ where: { campaignId: newCampaignId } })
    : null;
  record(
    'CREATE1',
    'create-campaign: DRAFT campaign persisted with mapped fields + requirement',
    (createFromPlan.status === 200 || createFromPlan.status === 201) &&
      !!campaignRow && campaignRow.status === 'DRAFT' &&
      campaignRow.keyMessage === 'Glow all summer' && campaignRow.budget === 30000 &&
      campaignRow.requirements.length === 1 && campaignRow.requirements[0].minFollowers === 5000,
    `campaignId=${newCampaignId} status=${campaignRow?.status} budget=${campaignRow?.budget} keyMessage=${JSON.stringify(campaignRow?.keyMessage)} reqMinFollowers=${campaignRow?.requirements?.[0]?.minFollowers}`,
  );
  record(
    'CREATE2',
    'create-campaign: SmartPlanBrief attached (inputMode AI) to the new campaign',
    !!briefRow && briefRow.strategy === 'plan-strategy' && briefRow.inputMode === 'AI' && briefRow.campaignId === newCampaignId,
    `brief.id=${briefRow?.id} strategy=${JSON.stringify(briefRow?.strategy)} inputMode=${briefRow?.inputMode}`,
  );

  // ── brief-by-campaign returns the attached brief ──
  const byCampaign = await http('GET', `/smart-plan/brief/by-campaign/${newCampaignId}`, brand.token);
  record(
    'BYCAMP1',
    'GET /brief/by-campaign/:id returns the attached brief',
    byCampaign.status === 200 && byCampaign.json?.strategy === 'plan-strategy' && byCampaign.json?.briefBody === 'plan-brief',
    `strategy=${JSON.stringify(byCampaign.json?.strategy)}`,
  );

  // ── scoping: saving a NEW standalone brief must NOT wipe the campaign-attached brief ──
  await http('POST', '/smart-plan/save', brand.token, { strategy: `S2-${stamp}` });
  const briefStillThere = await prisma.smartPlanBrief.findFirst({ where: { campaignId: newCampaignId } });
  const standaloneCount = await prisma.smartPlanBrief.count({ where: { createdBy: brand.userId, campaignId: null } });
  record(
    'SCOPE1',
    'New standalone save replaces only standalone brief; campaign-attached brief survives',
    !!briefStillThere && standaloneCount === 1,
    `campaignBriefSurvives=${!!briefStillThere} standaloneCount=${standaloneCount} (expect 1)`,
  );

  // ── SUMMARY ──
  const passed = checks.filter((c) => c.pass).length;
  console.log(`\n=== SUMMARY: ${passed}/${checks.length} checks passed ===`);
  const failed = checks.filter((c) => !c.pass);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(`  [${f.id}] ${f.name} :: ${f.evidence}`);
  }
}

main()
  .catch((e) => {
    console.error('HARNESS ERROR:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
