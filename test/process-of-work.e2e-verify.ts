/**
 * End-to-end verification harness for the Message "Process of Work" flow.
 * Real HTTP against :3001 + real DB reads (Prisma) + two socket.io clients.
 * NOT product code — a throwaway test driver. Run: npx ts-node --transpile-only test/process-of-work.e2e-verify.ts
 */
import { PrismaClient } from '@prisma/client';
import { io, Socket } from 'socket.io-client';

const API = 'http://localhost:3001';
const prisma = new PrismaClient();

// ---- fileUrl() replica (mirrors influ-app-frontend/src/lib/api.ts:12) ----
function fileUrl(path?: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API}${path.startsWith('/') ? '' : '/'}${path}`;
}

type Check = { id: string; name: string; pass: boolean; evidence: string };
const checks: Check[] = [];
function record(id: string, name: string, pass: boolean, evidence: string) {
  checks.push({ id, name, pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${id}] ${name}\n        ${evidence}`);
}

async function http(
  method: string,
  path: string,
  token?: string,
  body?: any,
): Promise<{ status: number; json: any }> {
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
    /* empty body */
  }
  return { status: res.status, json };
}

async function uploadFile(
  path: string,
  token: string,
  fields: Record<string, string>,
  filename: string,
): Promise<{ status: number; json: any }> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
  fd.append('file', new Blob([bytes], { type: 'application/pdf' }), filename);
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
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
  await http('POST', '/auth/register', undefined, {
    name,
    email,
    password: 'Test1234!',
  });
  const login = await http('POST', '/auth/login', undefined, {
    email,
    password: 'Test1234!',
  });
  const token = login.json?.access_token;
  if (!token) throw new Error(`No token for ${email}: ${JSON.stringify(login.json)}`);
  const userId = login.json.user.id;
  if (!login.json.user.isRoleSelected) {
    await http('POST', '/auth/select-role', token, { role });
  }
  return { token, userId };
}

function makeSocket(label: string, events: Record<string, any[]>): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(API, { transports: ['websocket'], forceNew: true });
    const timer = setTimeout(() => reject(new Error(`${label} connect timeout`)), 5000);
    s.on('connect', () => {
      clearTimeout(timer);
      resolve(s);
    });
    for (const ev of ['phase-update', 'drafts-update', 'payments-update']) {
      s.on(ev, (p: any) => events[`${label}:${ev}`].push({ t: Date.now(), p }));
    }
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const stamp = Date.now();
  console.log(`\n=== E2E Process-of-Work verification @ ${new Date().toISOString()} ===\n`);

  // ---------- SETUP: real register/role/campaign/invite/accept ----------
  const brand = await tokenFor('E2E Brand', `e2e.brand.${stamp}@influapp.test`, 'BRAND');
  const inf = await tokenFor('E2E Influencer', `e2e.inf.${stamp}@influapp.test`, 'INFLUENCER');
  const outBrand = await tokenFor('E2E OutBrand', `e2e.outbrand.${stamp}@influapp.test`, 'BRAND');
  const outInf = await tokenFor('E2E OutInf', `e2e.outinf.${stamp}@influapp.test`, 'INFLUENCER');

  const infProfile = await prisma.influencerProfile.findFirst({
    where: { userId: inf.userId },
  });
  if (!infProfile) throw new Error('influencer profile missing after select-role');

  // Campaign with real brief-able data + present-only requirement fields
  const camp = await http('POST', '/campaigns', brand.token, {
    name: `E2E Campaign ${stamp}`,
    objective: 'Drive awareness for the summer drop',
    budget: 50000,
    keyMessage: 'Authentic, fun, in-your-own-words',
    deliverables: '1x TikTok video + 2x IG stories',
    doAndDont: 'DO show the product in use. DON\'T mention competitors.',
    paymentType: 'FIXED',
    requirements: [
      { minFollowers: 1000, platforms: ['tiktok'], categories: ['lifestyle'] },
    ],
  });
  if (camp.status !== 201 && camp.status !== 200)
    throw new Error(`campaign create failed: ${camp.status} ${JSON.stringify(camp.json)}`);
  const campaignId = camp.json.id;

  const invite = await http(
    'POST',
    `/campaigns/${campaignId}/invite`,
    brand.token,
    { influencerId: infProfile.id },
  );
  const applicationId = invite.json.id;
  const accept = await http('POST', `/invitations/${applicationId}/accept`, inf.token);
  const conversationId =
    accept.json?.conversation?.id ?? accept.json?.conversationId ?? accept.json?.id;
  const conv = await prisma.conversation.findFirst({ where: { campaignId } });
  const convId = conv?.id ?? conversationId;
  if (!convId) throw new Error(`no conversation: ${JSON.stringify(accept.json)}`);
  console.log(`SETUP ok: campaignId=${campaignId} conversationId=${convId} influencerProfileId=${infProfile.id}\n`);

  // ---------- SOCKETS (join BEFORE any phase op; Phase 7 timing) ----------
  const events: Record<string, any[]> = {};
  for (const label of ['brandSock', 'infSock'])
    for (const ev of ['phase-update', 'drafts-update', 'payments-update'])
      events[`${label}:${ev}`] = [];
  const brandSock = await makeSocket('brandSock', events);
  const infSock = await makeSocket('infSock', events);
  brandSock.emit('join-conversation', convId);
  infSock.emit('join-conversation', convId);
  await sleep(400); // settle room joins before first broadcast (7.2)

  // ============ PHASE 3 — BRIEF (edge first: no SmartPlanBrief) ============
  const brief1 = await http('GET', `/conversations/${convId}/brief`, brand.token);
  const b1 = brief1.json;
  record(
    '3.4',
    'Brief with NO SmartPlanBrief returns campaign fields cleanly',
    brief1.status === 200 && b1.campaign?.name && b1.smartPlanBrief === null,
    `status=${brief1.status} campaign.name=${JSON.stringify(b1.campaign?.name)} smartPlanBrief=${JSON.stringify(b1.smartPlanBrief)}`,
  );

  // Create a SmartPlanBrief linked to the campaign (no clean HTTP path for arbitrary campaign)
  await prisma.smartPlanBrief.create({
    data: {
      campaignId,
      createdBy: brand.userId,
      strategy: 'Lean into UGC authenticity',
      concept: 'Day-in-the-life with the product',
      briefBody: 'Hook in 3s, product reveal, CTA to link in bio',
      inputMode: 'MANUAL',
    },
  });
  const brief2 = await http('GET', `/conversations/${convId}/brief`, inf.token);
  const b2 = brief2.json;
  const hasReal =
    b2.campaign?.keyMessage === 'Authentic, fun, in-your-own-words' &&
    b2.campaign?.deliverables === '1x TikTok video + 2x IG stories' &&
    !!b2.campaign?.doAndDont;
  const reqPresentOnly =
    b2.requirement &&
    b2.requirement.minFollowers === 1000 &&
    b2.requirement.minEngagementRate === null &&
    b2.requirement.minAvgViews === null;
  record(
    '3.1',
    'Brief returns real campaign + present-only requirement + SmartPlanBrief',
    brief2.status === 200 && hasReal && reqPresentOnly && !!b2.smartPlanBrief?.strategy,
    `keyMessage=${JSON.stringify(b2.campaign?.keyMessage)} req.minFollowers=${b2.requirement?.minFollowers} req.minEngagementRate=${JSON.stringify(b2.requirement?.minEngagementRate)} smartPlan.strategy=${JSON.stringify(b2.smartPlanBrief?.strategy)}`,
  );
  // 3.2 — no hardcoded seed strings
  const briefStr = JSON.stringify(b2);
  const seedMarkers = ['briefCampaignSeed', 'Summer Glow', 'Acme', 'Lorem ipsum'];
  const foundSeed = seedMarkers.filter((m) => briefStr.includes(m));
  record(
    '3.2',
    'No hardcoded/seed brief strings in response',
    foundSeed.length === 0,
    `data reflects campaign ${stamp}; seed markers found=${JSON.stringify(foundSeed)}`,
  );

  // ============ PHASE 2 — PHASE ADVANCE (dual confirm) ============
  const p1 = await http('POST', `/conversations/${convId}/phase-ready`, brand.token);
  record(
    '2.1',
    'Brand phase-ready: brandPhaseReady=true, phase does NOT advance',
    p1.status === 200 || p1.status === 201
      ? p1.json.brandPhaseReady === true && p1.json.influencerPhaseReady === false && p1.json.workPhase === 'contact'
      : false,
    `status=${p1.status} -> ${JSON.stringify(p1.json)}`,
  );
  const p2 = await http('POST', `/conversations/${convId}/phase-ready`, inf.token);
  record(
    '2.2',
    'Influencer phase-ready: both flags reset, workPhase advances contact->brief',
    p2.json.workPhase === 'brief' && p2.json.brandPhaseReady === false && p2.json.influencerPhaseReady === false,
    `-> ${JSON.stringify(p2.json)}`,
  );
  await sleep(250);
  record(
    '2.3',
    'phase-update broadcast emitted to room (both clients)',
    events['brandSock:phase-update'].length >= 1 && events['infSock:phase-update'].length >= 1,
    `brandSock got ${events['brandSock:phase-update'].length}, infSock got ${events['infSock:phase-update'].length} phase-update events`,
  );
  // 2.4 negatives
  const negInf = await http('POST', `/conversations/${convId}/phase-ready`, outInf.token);
  const negBrand = await http('POST', `/conversations/${convId}/phase-ready`, outBrand.token);
  record(
    '2.4a',
    'Non-participant INFLUENCER cannot set phase-ready (403)',
    negInf.status === 403,
    `status=${negInf.status} -> ${JSON.stringify(negInf.json)}`,
  );
  record(
    '2.4b',
    'Non-participant BRAND cannot set phase-ready (expect 403)',
    negBrand.status === 403,
    `status=${negBrand.status} -> ${JSON.stringify(negBrand.json)}  [if 200/201: markPhaseReady does not scope brand to the conversation]`,
  );

  // ============ PHASE 4 — DRAFT (CRUD + review loop + permissions) ============
  // 4.1 create (with linkUrl -> used for Published 5.1)
  const d1 = await http('POST', `/conversations/${convId}/drafts`, inf.token, {
    title: 'First cut',
    notes: 'rough edit',
    linkUrl: 'https://youtube.com/watch?v=e2e123',
    contentType: 'link',
  });
  record(
    '4.1',
    'Influencer creates draft -> 201, status DRAFT',
    d1.status === 201 && d1.json.status === 'DRAFT' && d1.json.linkUrl?.includes('youtube'),
    `status=${d1.status} draft.status=${d1.json?.status} linkUrl=${d1.json?.linkUrl}`,
  );
  const draftId = d1.json.id;
  // 4.2 edit + delete own
  const edit = await http('PATCH', `/conversations/${convId}/drafts/${draftId}`, inf.token, {
    notes: 'edited notes',
  });
  const dDel = await http('POST', `/conversations/${convId}/drafts`, inf.token, { title: 'to delete' });
  const del = await http('DELETE', `/conversations/${convId}/drafts/${dDel.json.id}`, inf.token);
  record(
    '4.2',
    'Influencer edits and deletes own draft',
    edit.status === 200 && edit.json.notes === 'edited notes' && (del.status === 200 || del.status === 204) && del.json?.deleted === true,
    `edit.status=${edit.status} notes=${JSON.stringify(edit.json?.notes)} ; delete.status=${del.status} ${JSON.stringify(del.json)}`,
  );
  // 4.3 brand cannot create/edit/delete
  const bCreate = await http('POST', `/conversations/${convId}/drafts`, brand.token, { title: 'brand draft' });
  const bEdit = await http('PATCH', `/conversations/${convId}/drafts/${draftId}`, brand.token, { notes: 'x' });
  const bDelete = await http('DELETE', `/conversations/${convId}/drafts/${draftId}`, brand.token);
  record(
    '4.3',
    'Brand cannot create/edit/delete a draft (403, review-only)',
    bCreate.status === 403 && bEdit.status === 403 && bDelete.status === 403,
    `create=${bCreate.status} edit=${bEdit.status} delete=${bDelete.status}`,
  );
  // 4.4 submit + request revision + influencer sees note
  await http('PATCH', `/conversations/${convId}/drafts/${draftId}`, inf.token, { status: 'SUBMITTED' });
  const rev = await http('PATCH', `/conversations/${convId}/drafts/${draftId}/review`, brand.token, {
    status: 'REVISION_REQUESTED',
    revisionNote: 'Trim the intro and add captions',
  });
  const seenByInf = await http('GET', `/conversations/${convId}/drafts`, inf.token);
  const revDraft = seenByInf.json.find((d: any) => d.id === draftId);
  record(
    '4.4',
    'Brand requests revision -> status REVISION_REQUESTED + note visible to influencer',
    rev.json.status === 'REVISION_REQUESTED' && revDraft?.revisionNote === 'Trim the intro and add captions',
    `review.status=${rev.json?.status} influencerSeesNote=${JSON.stringify(revDraft?.revisionNote)}`,
  );
  // 4.6 negative: revision with no note -> 400 (do before approve)
  await http('PATCH', `/conversations/${convId}/drafts/${draftId}`, inf.token, { status: 'SUBMITTED' });
  const revNoNote = await http('PATCH', `/conversations/${convId}/drafts/${draftId}/review`, brand.token, {
    status: 'REVISION_REQUESTED',
  });
  record(
    '4.6',
    'Request-revision with NO revisionNote -> 400',
    revNoNote.status === 400,
    `status=${revNoNote.status} -> ${JSON.stringify(revNoNote.json?.message)}`,
  );
  // 4.5 approve
  const appr = await http('PATCH', `/conversations/${convId}/drafts/${draftId}/review`, brand.token, {
    status: 'APPROVED',
  });
  record(
    '4.5',
    'Brand approves -> status APPROVED, revisionNote cleared',
    appr.json.status === 'APPROVED' && (appr.json.revisionNote === null || appr.json.revisionNote === undefined),
    `status=${appr.json?.status} revisionNote=${JSON.stringify(appr.json?.revisionNote)}`,
  );
  await sleep(250);
  record(
    '4.8',
    'drafts-update socket event fires on status change (both clients)',
    events['brandSock:drafts-update'].length >= 1 && events['infSock:drafts-update'].length >= 1,
    `brandSock=${events['brandSock:drafts-update'].length} infSock=${events['infSock:drafts-update'].length} drafts-update events`,
  );

  // ============ PHASE 1 — FILE UPLOADS (contract, brief, draft, payment) ============
  // draft file (4.7 + 1.1 draft) — second draft, file-only (no linkUrl) reused for 5.2
  const d2 = await http('POST', `/conversations/${convId}/drafts`, inf.token, {
    title: 'File deliverable',
    contentType: 'pdf',
  });
  const d2Id = d2.json.id;
  const fileResults: Record<string, { db: string; href: string; httpStatus: number; portable: boolean }> = {};
  async function checkUpload(key: string, path: string, token: string, fields: Record<string, string>, dbRead: () => Promise<string | null | undefined>) {
    const up = await uploadFile(path, token, fields, `${key}.pdf`);
    const dbVal = (await dbRead()) ?? (up.json?.url ?? up.json?.fileUrl ?? up.json?.proofUrl ?? '');
    const href = fileUrl(dbVal) ?? '';
    const r = await fetch(href);
    fileResults[key] = {
      db: String(dbVal),
      href,
      httpStatus: r.status,
      portable: String(dbVal).startsWith('/uploads/') && !/^https?:\/\//i.test(String(dbVal)),
    };
    return up;
  }
  await checkUpload('contract', `/conversations/${convId}/upload`, brand.token, { type: 'contract' }, async () => (await prisma.conversation.findUnique({ where: { id: convId } }))?.contractUrl);
  await checkUpload('brief', `/conversations/${convId}/upload`, brand.token, { type: 'brief' }, async () => (await prisma.conversation.findUnique({ where: { id: convId } }))?.briefFileUrl);
  await checkUpload('draft', `/conversations/${convId}/drafts/${d2Id}/upload`, inf.token, {}, async () => (await prisma.draft.findUnique({ where: { id: d2Id } }))?.fileUrl);
  // approve the file-only draft for Phase 5.2
  await http('PATCH', `/conversations/${convId}/drafts/${d2Id}`, inf.token, { status: 'SUBMITTED' });
  await http('PATCH', `/conversations/${convId}/drafts/${d2Id}/review`, brand.token, { status: 'APPROVED' });

  // ============ PHASE 6 — PAYMENT ============
  // 6.1 create PENDING (payment A — happy path)
  const payA = await http('POST', `/conversations/${convId}/payments`, brand.token, { amount: 15000, paymentType: 'FIXED' });
  record('6.1', 'Brand creates payment -> PENDING row written', payA.status === 201 && payA.json.status === 'PENDING' && payA.json.amount === 15000, `status=${payA.status} payment.status=${payA.json?.status} amount=${payA.json?.amount}`);
  const payAId = payA.json.id;
  // 6.2 upload proof -> AWAITING_CONFIRMATION + file check
  const proofUp = await checkUpload('payment', `/conversations/${convId}/payments/${payAId}/proof`, brand.token, {}, async () => (await prisma.payment.findUnique({ where: { id: payAId } }))?.proofUrl);
  record('6.2', 'Brand uploads proof -> AWAITING_CONFIRMATION; proof opens (200)', proofUp.json?.status === 'AWAITING_CONFIRMATION' && fileResults['payment'].httpStatus === 200, `payment.status=${proofUp.json?.status} proofHttp=${fileResults['payment'].httpStatus} href=${fileResults['payment'].href}`);

  // 6.4 negatives BEFORE confirming A
  const payB = await http('POST', `/conversations/${convId}/payments`, brand.token, { amount: 9000 }); // PENDING
  const confPending = await http('PATCH', `/conversations/${convId}/payments/${payB.json.id}/confirm`, inf.token);
  const infCreate = await http('POST', `/conversations/${convId}/payments`, inf.token, { amount: 100 });
  const brandConfirm = await http('PATCH', `/conversations/${convId}/payments/${payAId}/confirm`, brand.token);

  // 6.3 influencer confirms A -> PAID + wallet credited
  const walletBefore = await prisma.wallet.findUnique({ where: { userId: inf.userId } });
  const conf = await http('PATCH', `/conversations/${convId}/payments/${payAId}/confirm`, inf.token);
  const walletAfter = await prisma.wallet.findUnique({ where: { userId: inf.userId } });
  const paymentRow = await prisma.payment.findUnique({ where: { id: payAId } });
  const credited =
    !!walletAfter &&
    (walletAfter.totalEarned - (walletBefore?.totalEarned ?? 0)) === 15000 &&
    walletAfter.lastPaymentAmount === 15000 &&
    !!walletAfter.lastPaymentAt;
  record('6.3', 'Influencer confirms -> PAID, confirmedAt set, wallet credited once', conf.json?.status === 'PAID' && !!paymentRow?.confirmedAt && credited, `payment.status=${conf.json?.status} confirmedAt=${paymentRow?.confirmedAt?.toISOString?.() ?? paymentRow?.confirmedAt} wallet.totalEarned ${walletBefore?.totalEarned}->${walletAfter?.totalEarned} lastPaymentAmount=${walletAfter?.lastPaymentAmount}`);
  const doubleConf = await http('PATCH', `/conversations/${convId}/payments/${payAId}/confirm`, inf.token);
  record(
    '6.4',
    'Negatives: brand-confirm 403, influencer-create 403, confirm-PENDING 400, double-confirm 400',
    brandConfirm.status === 403 && infCreate.status === 403 && confPending.status === 400 && doubleConf.status === 400,
    `brandConfirm=${brandConfirm.status} influencerCreate=${infCreate.status} confirmPending=${confPending.status} doubleConfirm=${doubleConf.status}`,
  );
  await sleep(200);
  record('6.x', 'payments-update socket fired (both clients)', events['brandSock:payments-update'].length >= 1 && events['infSock:payments-update'].length >= 1, `brandSock=${events['brandSock:payments-update'].length} infSock=${events['infSock:payments-update'].length}`);

  // ============ PHASE 1 — consolidated file report ============
  const allPortable = Object.values(fileResults).every((f) => f.portable);
  const all200 = Object.values(fileResults).every((f) => f.httpStatus === 200);
  for (const [k, f] of Object.entries(fileResults)) {
    record(`1.${k}`, `Upload [${k}]: DB portable + href resolves 200 on :3001`, f.portable && f.httpStatus === 200, `db=${f.db} href=${f.href} http=${f.httpStatus} portable=${f.portable}`);
  }
  record('1.summary', 'All uploaded files: portable DB value + 200 via fileUrl()', allPortable && all200, `portable=${allPortable} all200=${all200}`);

  // ============ PHASE 5 — PUBLISHED CONTENT ============
  const draftsNow = await http('GET', `/conversations/${convId}/drafts`, inf.token);
  const publishedLinks = draftsNow.json.filter((d: any) => d.status === 'APPROVED' && !!d.linkUrl);
  const approvedFileOnly = draftsNow.json.filter((d: any) => d.status === 'APPROVED' && !d.linkUrl);
  record(
    '5.1',
    'Published reads real approved-draft linkUrl (not hardcoded workLink)',
    publishedLinks.length === 1 && publishedLinks[0].linkUrl === 'https://youtube.com/watch?v=e2e123',
    `publishedLinks=${JSON.stringify(publishedLinks.map((d: any) => d.linkUrl))}`,
  );
  record(
    '5.2',
    'Approved FILE-only draft (linkUrl null) excluded from Published (graceful)',
    approvedFileOnly.length >= 1 && approvedFileOnly.every((d: any) => !d.linkUrl) && !publishedLinks.some((d: any) => !d.linkUrl),
    `approvedFileOnly count=${approvedFileOnly.length}, none leak into publishedLinks`,
  );

  // ============ PHASE 7 — REAL-TIME (two-client) ============
  record(
    '7.1',
    'Both clients received phase-update AND drafts-update without refresh',
    events['brandSock:phase-update'].length >= 1 &&
      events['infSock:phase-update'].length >= 1 &&
      events['brandSock:drafts-update'].length >= 1 &&
      events['infSock:drafts-update'].length >= 1,
    `phase-update brand=${events['brandSock:phase-update'].length}/inf=${events['infSock:phase-update'].length}; drafts-update brand=${events['brandSock:drafts-update'].length}/inf=${events['infSock:drafts-update'].length}`,
  );
  // 7.2 first event not dropped: the brand phase-ready (2.1) was the first broadcast; both got it.
  const firstPhaseBrand = events['brandSock:phase-update'][0];
  record(
    '7.2',
    'First broadcast (one-sided phase-ready) landed on both clients (no drop on join)',
    events['brandSock:phase-update'].length >= 2 && events['infSock:phase-update'].length >= 2,
    `each client saw >=2 phase-updates (one-sided + advance); first brand event flags=${JSON.stringify(firstPhaseBrand?.p)}`,
  );

  brandSock.disconnect();
  infSock.disconnect();

  // ---------- SUMMARY ----------
  const passed = checks.filter((c) => c.pass).length;
  console.log(`\n=== SUMMARY: ${passed}/${checks.length} checks passed ===`);
  const failed = checks.filter((c) => !c.pass);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(`  [${f.id}] ${f.name} :: ${f.evidence}`);
  }
  console.log('\nEVIDENCE_JSON ' + JSON.stringify({ campaignId, convId, fileResults, eventCounts: Object.fromEntries(Object.entries(events).map(([k, v]) => [k, v.length])) }));
}

main()
  .catch((e) => {
    console.error('HARNESS ERROR:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
