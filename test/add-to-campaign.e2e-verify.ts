/**
 * E2E verification for "Add to Campaign" (discover page → POST /campaigns/:id/invite).
 * Real HTTP against :3001 + real DB reads (Prisma). NOT product code.
 * Run: npx ts-node --transpile-only test/add-to-campaign.e2e-verify.ts
 */
import { PrismaClient } from '@prisma/client';

const API = 'http://localhost:3001';
const prisma = new PrismaClient();

type Check = { id: string; name: string; pass: boolean; evidence: string };
const checks: Check[] = [];
function record(id: string, name: string, pass: boolean, evidence: string) {
  checks.push({ id, name, pass, evidence });
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  [${id}] ${name}\n        ${evidence}`,
  );
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
  if (!token)
    throw new Error(`no token ${email}: ${JSON.stringify(login.json)}`);
  if (!login.json.user.isRoleSelected)
    await http('POST', '/auth/select-role', token, { role });
  return { token, userId: login.json.user.id };
}
async function profileId(userId: string) {
  const p = await prisma.influencerProfile.findFirst({ where: { userId } });
  if (!p) throw new Error('no influencer profile');
  return p.id;
}

async function main() {
  const stamp = Date.now();
  console.log(
    `\n=== "Add to Campaign" E2E @ ${new Date().toISOString()} ===\n`,
  );

  const brand = await tokenFor(
    'ATC Brand',
    `atc.brand.${stamp}@influapp.test`,
    'BRAND',
  );
  const brand2 = await tokenFor(
    'ATC Brand2',
    `atc.brand2.${stamp}@influapp.test`,
    'BRAND',
  );
  const uA = await tokenFor(
    'ATC InfA',
    `atc.infa.${stamp}@influapp.test`,
    'INFLUENCER',
  );
  const uB = await tokenFor(
    'ATC InfB',
    `atc.infb.${stamp}@influapp.test`,
    'INFLUENCER',
  );
  const uC = await tokenFor(
    'ATC InfC',
    `atc.infc.${stamp}@influapp.test`,
    'INFLUENCER',
  );
  const infA = await profileId(uA.userId);
  const infB = await profileId(uB.userId);
  const infC = await profileId(uC.userId);

  // requirement-free PUBLIC campaign so apply() (A3) isn't blocked by requirement matching
  const c1 = await http('POST', '/campaigns', brand.token, {
    name: `ATC C1 ${stamp}`,
    visibility: 'PUBLIC',
  });
  const C1 = c1.json.id;
  const c2 = await http('POST', '/campaigns', brand2.token, {
    name: `ATC C2 ${stamp}`,
    visibility: 'PUBLIC',
  });
  const C2 = c2.json.id;

  // A1 — first invite
  const a1 = await http('POST', `/campaigns/${C1}/invite`, brand.token, {
    influencerId: infA,
  });
  const rowA = await prisma.campaignApplication.findUnique({
    where: { campaignId_influencerId: { campaignId: C1, influencerId: infA } },
  });
  record(
    'A1',
    'Brand adds registered influencer -> INVITED application created',
    (a1.status === 200 || a1.status === 201) &&
      a1.json.inviteResult === 'INVITED' &&
      rowA?.status === 'INVITED' &&
      rowA?.origin === 'INVITATION',
    `status=${a1.status} inviteResult=${a1.json?.inviteResult} dbStatus=${rowA?.status} origin=${rowA?.origin}`,
  );

  // A2 — re-invite (idempotent)
  const a2 = await http('POST', `/campaigns/${C1}/invite`, brand.token, {
    influencerId: infA,
  });
  const countA = await prisma.campaignApplication.count({
    where: { campaignId: C1, influencerId: infA },
  });
  record(
    'A2',
    'Re-inviting same influencer -> ALREADY_INVITED, no duplicate row',
    a2.json.inviteResult === 'ALREADY_INVITED' && countA === 1,
    `inviteResult=${a2.json?.inviteResult} rowCount=${countA}`,
  );

  // A3 — influencer applied first (PENDING) -> invite conflicts
  const applyB = await http('POST', `/campaigns/${C1}/apply`, uB.token);
  const a3 = await http('POST', `/campaigns/${C1}/invite`, brand.token, {
    influencerId: infB,
  });
  record(
    'A3',
    'Influencer already applied (PENDING) -> invite returns 409 conflict',
    (applyB.status === 200 || applyB.status === 201) &&
      a3.status === 409 &&
      /already applied/i.test(JSON.stringify(a3.json?.message)),
    `apply=${applyB.status} invite=${a3.status} msg=${JSON.stringify(a3.json?.message)}`,
  );

  // A4 — invite -> influencer declines -> re-invite flips back to INVITED
  const a4invite = await http('POST', `/campaigns/${C1}/invite`, brand.token, {
    influencerId: infC,
  });
  const decline = await http(
    'POST',
    `/invitations/${a4invite.json.id}/decline`,
    uC.token,
  );
  const a4re = await http('POST', `/campaigns/${C1}/invite`, brand.token, {
    influencerId: infC,
  });
  record(
    'A4',
    'Declined invite -> re-invite returns RE_INVITED (same row back to INVITED)',
    a4invite.json.inviteResult === 'INVITED' &&
      (decline.status === 200 || decline.status === 201) &&
      a4re.json.inviteResult === 'RE_INVITED',
    `invite=${a4invite.json?.inviteResult} decline=${decline.status} reinvite=${a4re.json?.inviteResult}`,
  );

  // A5 — ownership: brand2 doesn't own C1
  const a5 = await http('POST', `/campaigns/${C1}/invite`, brand2.token, {
    influencerId: infA,
  });
  record(
    'A5',
    'Brand that does NOT own the campaign -> 404',
    a5.status === 404,
    `status=${a5.status} msg=${JSON.stringify(a5.json?.message)}`,
  );

  // A6 — non-existent influencer
  const a6 = await http('POST', `/campaigns/${C1}/invite`, brand.token, {
    influencerId: 'does-not-exist',
  });
  record(
    'A6',
    'Inviting a non-existent influencer -> 404',
    a6.status === 404,
    `status=${a6.status} msg=${JSON.stringify(a6.json?.message)}`,
  );

  // A7 — role guard: influencer cannot invite
  const a7 = await http('POST', `/campaigns/${C1}/invite`, uA.token, {
    influencerId: infB,
  });
  record(
    'A7',
    'Influencer role cannot invite -> 403',
    a7.status === 403,
    `status=${a7.status}`,
  );

  // A8 — invited influencer accepts -> conversation; subsequent invite is ALREADY_ACCEPTED
  const invites = await http('GET', '/invitations', uA.token);
  const myInvite = (invites.json ?? []).find(
    (i: any) => i.campaignId === C1,
  ) ?? { id: a1.json.id };
  const accept = await http(
    'POST',
    `/invitations/${myInvite.id}/accept`,
    uA.token,
  );
  const conv = await prisma.conversation.findFirst({
    where: { campaignId: C1, influencerId: infA },
  });
  const a8re = await http('POST', `/campaigns/${C1}/invite`, brand.token, {
    influencerId: infA,
  });
  record(
    'A8',
    'Invited influencer accepts -> conversation created; re-invite -> ALREADY_ACCEPTED',
    (accept.status === 200 || accept.status === 201) &&
      !!conv &&
      a8re.json.inviteResult === 'ALREADY_ACCEPTED',
    `accept=${accept.status} conversationId=${conv?.id} reinvite=${a8re.json?.inviteResult}`,
  );

  const passed = checks.filter((c) => c.pass).length;
  console.log(`\n=== SUMMARY: ${passed}/${checks.length} checks passed ===`);
  const failed = checks.filter((c) => !c.pass);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed)
      console.log(`  [${f.id}] ${f.name} :: ${f.evidence}`);
  }
  console.log(`\nIDS campaignC1=${C1} infA=${infA}`);
}

main()
  .catch((e) => {
    console.error('HARNESS ERROR:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
