/**
 * E2E verification for Campaign Management (campaigns module CRUD + lifecycle).
 * Real HTTP against :3001 + real DB reads (Prisma). NOT product code.
 * Run: npx ts-node --transpile-only test/campaign-management.e2e-verify.ts
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
  if (!token) throw new Error(`no token ${email}`);
  if (!login.json.user.isRoleSelected)
    await http('POST', '/auth/select-role', token, { role });
  return { token, userId: login.json.user.id };
}

async function main() {
  const stamp = Date.now();
  console.log(
    `\n=== Campaign Management E2E @ ${new Date().toISOString()} ===\n`,
  );

  const brand = await tokenFor(
    'CM Brand',
    `cm.brand.${stamp}@influapp.test`,
    'BRAND',
  );
  const brand2 = await tokenFor(
    'CM Brand2',
    `cm.brand2.${stamp}@influapp.test`,
    'BRAND',
  );
  const inf = await tokenFor(
    'CM Inf',
    `cm.inf.${stamp}@influapp.test`,
    'INFLUENCER',
  );

  // CM1 — create -> DRAFT, owner clientBrand auto-resolved
  const create = await http('POST', '/campaigns', brand.token, {
    name: `CM Campaign ${stamp}`,
    objective: 'Awareness',
    budget: 20000,
  });
  const CA = create.json?.id;
  record(
    'CM1',
    'Create campaign -> DRAFT with auto-resolved clientBrand',
    (create.status === 200 || create.status === 201) &&
      create.json?.status === 'DRAFT' &&
      !!create.json?.clientBrandId,
    `status=${create.status} campaignStatus=${create.json?.status} clientBrandId=${create.json?.clientBrandId}`,
  );

  // CM2 — list scoping
  const list = await http('GET', '/campaigns', brand.token);
  const listInf = await http('GET', '/campaigns', inf.token);
  record(
    'CM2',
    'List returns owner campaigns; influencer gets empty list',
    Array.isArray(list.json) &&
      list.json.some((c: any) => c.id === CA) &&
      Array.isArray(listInf.json) &&
      listInf.json.length === 0,
    `ownerListHasCA=${list.json?.some?.((c: any) => c.id === CA)} influencerListLen=${listInf.json?.length}`,
  );

  // CM3 — detail ownership (non-owner obscured as 404)
  const detailOwner = await http('GET', `/campaigns/${CA}`, brand.token);
  const detailOther = await http('GET', `/campaigns/${CA}`, brand2.token);
  record(
    'CM3',
    'Detail: owner 200 (with requirements/applications/clientBrand); non-owner 404',
    detailOwner.status === 200 &&
      'requirements' in detailOwner.json &&
      'applications' in detailOwner.json &&
      detailOther.status === 404,
    `owner=${detailOwner.status} nonOwner=${detailOther.status}`,
  );

  // CM4 — update fields + ownership guard
  const upd = await http('PATCH', `/campaigns/${CA}`, brand.token, {
    name: `CM Renamed ${stamp}`,
    budget: 35000,
  });
  const updOther = await http('PATCH', `/campaigns/${CA}`, brand2.token, {
    name: 'hijack',
  });
  record(
    'CM4',
    'Update persists owner edits; non-owner update -> 404',
    upd.status === 200 &&
      upd.json?.name === `CM Renamed ${stamp}` &&
      upd.json?.budget === 35000 &&
      updOther.status === 404,
    `name=${JSON.stringify(upd.json?.name)} budget=${upd.json?.budget} nonOwnerUpdate=${updOther.status}`,
  );

  // CM5 — valid status transition DRAFT->ACTIVE; invalid ACTIVE->DRAFT -> 400
  const toActive = await http('PATCH', `/campaigns/${CA}`, brand.token, {
    status: 'ACTIVE',
  });
  const backToDraft = await http('PATCH', `/campaigns/${CA}`, brand.token, {
    status: 'DRAFT',
  });
  record(
    'CM5',
    'Status: DRAFT->ACTIVE allowed; ACTIVE->DRAFT rejected (400 invalid transition)',
    toActive.status === 200 &&
      toActive.json?.status === 'ACTIVE' &&
      backToDraft.status === 400,
    `toActive=${toActive.json?.status} backToDraft=${backToDraft.status} msg=${JSON.stringify(backToDraft.json?.message)}`,
  );

  // CM6 — public listing reflects visibility PUBLIC + status ACTIVE/PUBLIC
  await http('PATCH', `/campaigns/${CA}`, brand.token, {
    visibility: 'PUBLIC',
  });
  const draftOnly = await http('POST', '/campaigns', brand.token, {
    name: `CM Draft ${stamp}`,
    visibility: 'PUBLIC',
  }); // stays DRAFT
  // /campaigns/public requires auth (controller-level JwtAuthGuard); "public" = visibility.
  // An influencer browsing public campaigns is the realistic caller.
  const publicList = await http('GET', '/campaigns/public', inf.token);
  const ids = (publicList.json ?? []).map((c: any) => c.id);
  record(
    'CM6',
    'Public listing includes ACTIVE+PUBLIC campaign, excludes DRAFT',
    publicList.status === 200 &&
      ids.includes(CA) &&
      !ids.includes(draftOnly.json?.id),
    `activePublicListed=${ids.includes(CA)} draftListed=${ids.includes(draftOnly.json?.id)}`,
  );

  // CM7 — applications listing + conversationId join (apply -> accept)
  const apply = await http('POST', `/campaigns/${CA}/apply`, inf.token);
  const appsBefore = await http(
    'GET',
    `/campaigns/${CA}/applications`,
    brand.token,
  );
  const appRow = (appsBefore.json ?? [])[0];
  const beforeConv = appRow?.conversationId ?? null;
  const accept = await http(
    'PATCH',
    `/campaigns/${CA}/applications/${appRow?.id}`,
    brand.token,
    { status: 'ACCEPTED' },
  );
  const appsAfter = await http(
    'GET',
    `/campaigns/${CA}/applications`,
    brand.token,
  );
  const afterConv = (appsAfter.json ?? []).find(
    (a: any) => a.id === appRow?.id,
  )?.conversationId;
  record(
    'CM7',
    'Applications: applicant listed (conversationId null), accept creates conversation + populates conversationId',
    (apply.status === 200 || apply.status === 201) &&
      !!appRow &&
      beforeConv === null &&
      accept.json?.conversationId &&
      afterConv === accept.json.conversationId,
    `apply=${apply.status} beforeConv=${beforeConv} acceptConvId=${accept.json?.conversationId} afterConv=${afterConv}`,
  );

  // CM8a — cannot delete an ACTIVE campaign
  const delActive = await http('DELETE', `/campaigns/${CA}`, brand.token);
  record(
    'CM8a',
    'Delete ACTIVE campaign -> 400 (only DRAFT/CANCELLED deletable)',
    delActive.status === 400,
    `status=${delActive.status} msg=${JSON.stringify(delActive.json?.message)}`,
  );

  // CM8b — cancel then delete -> cascade removes conversation + application
  await http('PATCH', `/campaigns/${CA}`, brand.token, { status: 'CANCELLED' });
  const delCancelled = await http('DELETE', `/campaigns/${CA}`, brand.token);
  const campGone = await prisma.campaign.findUnique({ where: { id: CA } });
  const convGone = await prisma.conversation.findFirst({
    where: { campaignId: CA },
  });
  const appsGone = await prisma.campaignApplication.findFirst({
    where: { campaignId: CA },
  });
  record(
    'CM8b',
    'Delete CANCELLED campaign -> cascade removes campaign + conversation + applications',
    (delCancelled.status === 200 || delCancelled.status === 204) &&
      !campGone &&
      !convGone &&
      !appsGone,
    `delete=${delCancelled.status} campaignGone=${!campGone} conversationGone=${!convGone} applicationsGone=${!appsGone}`,
  );

  // CM9 — create requires name; influencer cannot create
  const noName = await http('POST', '/campaigns', brand.token, {
    objective: 'x',
  });
  const infCreate = await http('POST', '/campaigns', inf.token, {
    name: 'inf camp',
  });
  record(
    'CM9',
    'Create validation: missing name -> 400; influencer create -> 403',
    noName.status === 400 && infCreate.status === 403,
    `missingName=${noName.status} influencerCreate=${infCreate.status}`,
  );

  const passed = checks.filter((c) => c.pass).length;
  console.log(`\n=== SUMMARY: ${passed}/${checks.length} checks passed ===`);
  const failed = checks.filter((c) => !c.pass);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed)
      console.log(`  [${f.id}] ${f.name} :: ${f.evidence}`);
  }
}

main()
  .catch((e) => {
    console.error('HARNESS ERROR:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
