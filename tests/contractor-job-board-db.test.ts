/**
 * Contractor Hub job board — real-Postgres acceptance of the service layer
 * (server/contractor-jobs/service.ts + migrations/0029). Drives the exact SQL
 * the routes run; does NOT boot the app (route wiring is covered by
 * tests/contractor-job-board-static.test.ts).
 *
 * SAFETY: requires TEST_DATABASE_URL pointing at a disposable database whose
 * schema is `drizzle-kit push` of shared/schema.ts (or a restored clone), run
 * AS THE ROLE THAT OWNS the app tables (0029's guard). Refuses
 * staging/production-shaped names/hosts, verifies current_database() before
 * any write, never prints a URL, removes its fixtures in finally. Skips (exit
 * 0) when TEST_DATABASE_URL is unset.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable npx tsx tests/contractor-job-board-db.test.ts
 */
import { Pool } from "pg";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FORBIDDEN = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i, /^paylinkapp$/i];

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.log("SKIP: TEST_DATABASE_URL not set — job board DB acceptance not run (this is not a failure).");
    process.exit(0);
  }
  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, "");
  for (const p of FORBIDDEN) if (p.test(dbName) || p.test(parsed.hostname)) throw new Error("Refusing to run against a staging/production-shaped database.");
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL equals this process's DATABASE_URL.");

  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jobboard-store-"));
  process.env.PRIVATE_STORAGE_DIR = storeDir;
  const svc = await import("../server/contractor-jobs/service");

  const pool = new Pool({ connectionString: url, max: 8 });
  const cur = (await pool.query("SELECT current_database() d")).rows[0].d;
  assert.equal(cur, dbName, "current_database() must match TEST_DATABASE_URL");

  let pass = 0, fail = 0;
  const ok = (n: string, c: unknown) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`); } };
  const okR = (n: string, r: { ok: boolean; status: number; message?: string }, status: number) =>
    ok(`${n} (${r.status}${r.ok ? "" : ": " + r.message})`, r.status === status);

  const sfx = crypto.randomBytes(4).toString("hex");
  const ids = {
    coA: crypto.randomUUID(), coB: crypto.randomUUID(),
    adminA: crypto.randomUUID(), adminB: crypto.randomUUID(),
    cA1: crypto.randomUUID(), cA2: crypto.randomUUID(), cA3: crypto.randomUUID(), cB1: crypto.randomUUID(), empA: crypto.randomUUID(),
    uA1: crypto.randomUUID(), uA2: crypto.randomUUID(), uA3: crypto.randomUUID(), uB1: crypto.randomUUID(),
    jobA: crypto.randomUUID(), jobB: crypto.randomUUID(),
  };
  let tenantA = "", tenantB = "";
  const suspended = new Set<string>();

  const deps = {
    pool,
    tenantGate: async (cid: string) => suspended.has(cid) ? { allowed: false, reason: "Account suspended" } : { allowed: true },
    tenantIdForCompany: async (cid: string) => (await pool.query(`SELECT tenant_id FROM tenant_companies WHERE company_id = $1 LIMIT 1`, [cid])).rows[0]?.tenant_id ?? null,
  };
  const admin = (userId: string, company: string) => ({ userId, contractor: null, canManageCompany: async (cid: string) => cid === company });
  const contractor = (userId: string, workerId: string, company: string, group = "1099_contractor") => ({
    userId, canManageCompany: async () => false,
    contractor: { workerId, companyId: company, workerType: "contractor", workerGroup: group, status: "active" },
  });
  const ADMIN_A = admin(ids.adminA, ids.coA);
  const ADMIN_B = admin(ids.adminB, ids.coB);
  const CA1 = contractor(ids.uA1, ids.cA1, ids.coA);
  const CA2 = contractor(ids.uA2, ids.cA2, ids.coA);
  const CA3 = contractor(ids.uA3, ids.cA3, ids.coA, "trades");
  const CB1 = contractor(ids.uB1, ids.cB1, ids.coB);
  const PLATFORM_SUPPORT = { userId: crypto.randomUUID(), contractor: null, canManageCompany: async () => false };

  const postIds: string[] = [];
  try {
    // ── Migration (strip psql meta-commands) ─────────────────────────────────
    const migration = fs.readFileSync("migrations/0029_contractor_job_board.sql", "utf8").split("\n").filter((l) => !l.startsWith("\\")).join("\n");
    await pool.query(migration);
    ok("0029 applies and re-applies cleanly", await pool.query(migration).then(() => true).catch((e) => { console.error(e.message); return false; }));
    ok("schema ready", await svc.jobBoardSchemaReady(pool));

    // ── Fixtures ─────────────────────────────────────────────────────────────
    for (const [co, label] of [[ids.coA, "A"], [ids.coB, "B"]] as const) {
      await pool.query(`INSERT INTO companies (id, name, subscription_status) VALUES ($1, $2, 'active')`, [co, `ZZ JobBoard ${label} ${sfx}`]);
      const t = (await pool.query(`INSERT INTO tenants (name, slug, status) VALUES ($1,$1,'active') RETURNING id`, [`zz-jobboard-${label.toLowerCase()}-${sfx}`])).rows[0].id;
      await pool.query(`INSERT INTO tenant_companies (tenant_id, company_id, is_primary) VALUES ($1,$2,true)`, [t, co]);
      if (label === "A") tenantA = t; else tenantB = t;
    }
    const worker = (id: string, co: string, type: string, group: string) =>
      pool.query(`INSERT INTO workers (id, company_id, first_name, last_name, worker_type, worker_group, status) VALUES ($1,$2,'ZZ',$3,$4,$5,'active')`, [id, co, `JB${sfx}`, type, group]);
    await worker(ids.cA1, ids.coA, "contractor", "1099_contractor");
    await worker(ids.cA2, ids.coA, "contractor", "1099_contractor");
    await worker(ids.cA3, ids.coA, "contractor", "trades");
    await worker(ids.cB1, ids.coB, "contractor", "1099_contractor");
    await worker(ids.empA, ids.coA, "employee", "hourly_employee");
    const user = (id: string, co: string, role: string, workerId: string | null) =>
      pool.query(`INSERT INTO users (id, username, password, role, company_id, worker_id) VALUES ($1,$2,'x',$3,$4,$5)`, [id, `zz_jb_${id.slice(0, 8)}`, role, co, workerId]);
    await user(ids.adminA, ids.coA, "admin", null);
    await user(ids.adminB, ids.coB, "admin", null);
    await user(ids.uA1, ids.coA, "contractor", ids.cA1);
    await user(ids.uA2, ids.coA, "contractor", ids.cA2);
    await user(ids.uA3, ids.coA, "contractor", ids.cA3);
    await user(ids.uB1, ids.coB, "contractor", ids.cB1);
    await pool.query(`INSERT INTO jobs (id, company_id, name) VALUES ($1,$2,'ZZ cost job A'), ($3,$4,'ZZ cost job B')`, [ids.jobA, ids.coA, ids.jobB, ids.coB]);

    const futureDeadline = new Date(Date.now() + 7 * 864e5).toISOString();

    // ── 1. One-time posting ─────────────────────────────────────────────────
    console.log("postings");
    let r: any = await svc.createPost(deps, ADMIN_A, ids.coA, { title: "Paint lobby", summary: "Two coats", scopeOfWork: "Lobby walls", budgetType: "fixed", budgetMax: 5000, submissionDeadline: futureDeadline, costJobId: ids.jobA });
    okR("admin creates a one-time draft", r, 201);
    const oneTime = r.body; postIds.push(oneTime.id);
    ok("posting is stamped with company + tenant", oneTime.companyId === ids.coA && oneTime.tenantId === tenantA && oneTime.status === "draft");
    okR("cost job from another company is rejected", await svc.createPost(deps, ADMIN_A, ids.coA, { title: "x", costJobId: ids.jobB }), 400);
    okR("status/companyId in the body are ignored, not applied", (r = await svc.updatePost(deps, ADMIN_A, oneTime.id, { status: "published", companyId: ids.coB } as any)), 400);
    okR("contractor cannot see a draft", await svc.getPost(deps, CA1, oneTime.id), 404);
    okR("admin publishes", (r = await svc.transitionPost(deps, ADMIN_A, oneTime.id, "publish")), 200);
    ok("published_at set", !!r.body.publishedAt && r.body.status === "published");
    okR("publishing twice is a 409", await svc.transitionPost(deps, ADMIN_A, oneTime.id, "publish"), 409);

    // ── 2. Recurring postings ───────────────────────────────────────────────
    r = await svc.createPost(deps, ADMIN_A, ids.coA, { title: "Weekly cleaning", summary: "Office", workType: "recurring", recurrenceFrequency: "weekly", budgetType: "hourly", budgetMax: 40 });
    const recurring = r.body; postIds.push(recurring.id);
    okR("admin publishes an ongoing recurring posting", await svc.transitionPost(deps, ADMIN_A, recurring.id, "publish"), 200);
    r = await svc.createPost(deps, ADMIN_A, ids.coA, { title: "Monthly audit", summary: "Books", workType: "recurring", recurrenceFrequency: "monthly", maximumAwards: 2 });
    const capped = r.body; postIds.push(capped.id);
    await svc.transitionPost(deps, ADMIN_A, capped.id, "publish");
    r = await svc.createPost(deps, ADMIN_A, ids.coA, { title: "Invited only", summary: "Secret", visibility: "invited_only" });
    const invitedOnly = r.body; postIds.push(invitedOnly.id);
    await svc.transitionPost(deps, ADMIN_A, invitedOnly.id, "publish");
    r = await svc.createPost(deps, ADMIN_A, ids.coA, { title: "Trades only", summary: "Plumbing", visibility: "selected_groups", eligibleGroups: ["trades"] });
    const tradesOnly = r.body; postIds.push(tradesOnly.id);
    await svc.transitionPost(deps, ADMIN_A, tradesOnly.id, "publish");
    r = await svc.createPost(deps, ADMIN_B, ids.coB, { title: "B job", summary: "Other tenant" });
    const postB = r.body; postIds.push(postB.id);
    await svc.transitionPost(deps, ADMIN_B, postB.id, "publish");

    // ── 3/4. Visibility ─────────────────────────────────────────────────────
    console.log("visibility + isolation");
    const avail = (await svc.listAvailablePosts(deps, CA1) as any).body.map((p: any) => p.id);
    ok("contractor A1 sees all_eligible A postings", avail.includes(oneTime.id) && avail.includes(recurring.id) && avail.includes(capped.id));
    ok("A1 does not see invited_only (not invited) or trades-only", !avail.includes(invitedOnly.id) && !avail.includes(tradesOnly.id));
    ok("A1 never sees company B's posting", !avail.includes(postB.id));
    ok("A3 (trades) sees the trades-only posting", (await svc.listAvailablePosts(deps, CA3) as any).body.some((p: any) => p.id === tradesOnly.id));
    okR("A1 → B posting by id is 404", await svc.getPost(deps, CA1, postB.id), 404);
    okR("B1 → A posting by id is 404", await svc.getPost(deps, CB1, oneTime.id), 404);
    okR("admin B → A posting is 404", await svc.getPost(deps, ADMIN_B, oneTime.id), 404);
    okR("admin B cannot list A's bids", await svc.listBidsForPost(deps, ADMIN_B, oneTime.id), 404);
    okR("admin B cannot edit A's posting", await svc.updatePost(deps, ADMIN_B, oneTime.id, { title: "pwned" }), 404);
    okR("admin B cannot close A's posting", await svc.transitionPost(deps, ADMIN_B, oneTime.id, "close"), 404);
    okR("admin B cannot list company A", await svc.listPostsForAdmin(deps, ADMIN_B, ids.coA), 404);
    okR("platform_support (no manage grant) cannot read A's bids", await svc.listBidsForPost(deps, PLATFORM_SUPPORT, oneTime.id), 404);
    okR("an employee (not contractor) cannot list available jobs", await svc.listAvailablePosts(deps, { ...CA1, contractor: { ...CA1.contractor, workerType: "employee" } }), 403);
    okR("invite rejects another company's contractor", await svc.inviteContractors(deps, ADMIN_A, invitedOnly.id, [ids.cB1]), 400);
    okR("invite rejects an employee", await svc.inviteContractors(deps, ADMIN_A, invitedOnly.id, [ids.empA]), 400);
    okR("admin invites A1", await svc.inviteContractors(deps, ADMIN_A, invitedOnly.id, [ids.cA1]), 201);
    ok("invited A1 now sees invited_only", (await svc.listAvailablePosts(deps, CA1) as any).body.some((p: any) => p.id === invitedOnly.id));
    const inv = (await svc.listInvitations(deps, ADMIN_A, invitedOnly.id) as any).body[0];
    okR("admin B cannot revoke A's invitation", await svc.revokeInvitation(deps, ADMIN_B, inv.id), 404);
    okR("admin A revokes", await svc.revokeInvitation(deps, ADMIN_A, inv.id), 200);
    ok("revoked A1 no longer sees invited_only", !(await svc.listAvailablePosts(deps, CA1) as any).body.some((p: any) => p.id === invitedOnly.id));
    const contractorView = (await svc.getPost(deps, CA1, oneTime.id) as any).body;
    ok("contractor view hides creator, cost job, award count", contractorView.createdByUserId === undefined && contractorView.costJobId === undefined && contractorView.awardsMade === undefined);

    // ── 7. Bid lifecycle ────────────────────────────────────────────────────
    console.log("bids");
    r = await svc.createBid(deps, CA1, oneTime.id, { proposedAmount: "4200", coverMessage: "Experienced", status: "awarded" } as any);
    okR("A1 drafts a bid", r, 201);
    const bidA1 = r.body;
    ok("draft ignores injected status", bidA1.status === "draft" && bidA1.revisionNumber === 0);
    okR("a second active bid by A1 is a 409", await svc.createBid(deps, CA1, oneTime.id, {}), 409);
    okR("B1 cannot bid on A's posting", await svc.createBid(deps, CB1, oneTime.id, { proposedAmount: 1 }), 404);
    okR("A1 cannot bid on invited_only after revoke", await svc.createBid(deps, CA1, invitedOnly.id, { proposedAmount: 1 }), 404);
    ok("admin does not see an unsent draft", (await svc.listBidsForPost(deps, ADMIN_A, oneTime.id) as any).body.length === 0);
    okR("A2 cannot edit A1's bid", await svc.updateBid(deps, CA2, bidA1.id, { proposedAmount: 1 }), 404);
    okR("A2 cannot submit A1's bid", await svc.submitBid(deps, CA2, bidA1.id), 404);
    okR("A2 cannot withdraw A1's bid", await svc.withdrawBid(deps, CA2, bidA1.id), 404);
    okR("A2 cannot read A1's bid versions", await svc.listBidVersions(deps, CA2, bidA1.id), 404);
    okR("A1 edits the draft", await svc.updateBid(deps, CA1, bidA1.id, { proposedAmount: "4100", estimatedStartDate: "2026-12-01" }), 200);
    okR("A1 submits", (r = await svc.submitBid(deps, CA1, bidA1.id)), 200);
    ok("submitted at revision 1", r.body.status === "submitted" && r.body.revisionNumber === 1);
    okR("A1 revises a submitted bid", (r = await svc.updateBid(deps, CA1, bidA1.id, { proposedAmount: "3900" })), 200);
    ok("revision 2 recorded, still submitted", r.body.revisionNumber === 2 && r.body.status === "submitted");
    const versions = (await svc.listBidVersions(deps, CA1, bidA1.id) as any).body;
    ok("two immutable versions kept (4100 → 3900)", versions.length === 2 && versions[0].snapshot.proposed_amount === "4100.00" && versions[1].snapshot.proposed_amount === "3900.00");

    r = await svc.createBid(deps, CA2, oneTime.id, { hourlyRate: 55, estimatedHours: 80, rateType: "hourly" });
    const bidA2 = r.body;
    await svc.submitBid(deps, CA2, bidA2.id);
    const adminBids = (await svc.listBidsForPost(deps, ADMIN_A, oneTime.id) as any).body;
    ok("admin sees both submitted bids", adminBids.length === 2);
    const mine = (await svc.listMyBids(deps, CA2) as any).body;
    ok("A2's 'my bids' contains only A2's bid", mine.length === 1 && mine[0].id === bidA2.id);
    const a2View = (await svc.getPost(deps, CA2, oneTime.id) as any).body;
    ok("A2's posting view shows only A2's own bid", a2View.myBid?.id === bidA2.id && JSON.stringify(a2View).indexOf("3900") === -1);

    okR("request revision needs a note", await svc.reviewBid(deps, ADMIN_A, bidA2.id, "request_revision", {}), 400);
    okR("admin requests a revision", (r = await svc.reviewBid(deps, ADMIN_A, bidA2.id, "request_revision", { note: "Fixed price please" })), 200);
    ok("A2 sees the admin's note", (await svc.listMyBids(deps, CA2) as any).body[0].revisionRequestNote === "Fixed price please");
    okR("A2 resubmits", (r = await svc.submitBid(deps, CA2, bidA2.id)), 200);
    okR("admin marks A1 under review", await svc.reviewBid(deps, ADMIN_A, bidA1.id, "review"), 200);
    okR("admin shortlists A1", await svc.reviewBid(deps, ADMIN_A, bidA1.id, "shortlist"), 200);
    okR("shortlisted bid is no longer contractor-editable", await svc.updateBid(deps, CA1, bidA1.id, { proposedAmount: 1 }), 409);
    okR("admin B cannot shortlist/award A's bids", await svc.reviewBid(deps, ADMIN_B, bidA2.id, "shortlist"), 404);

    // ── 8. Paused / closed postings reject submissions ──────────────────────
    console.log("paused / closed");
    r = await svc.createBid(deps, CA3, recurring.id, { proposedAmount: 100 });
    const bidA3draft = r.body;
    await svc.transitionPost(deps, ADMIN_A, recurring.id, "pause");
    okR("paused posting rejects a new bid", await svc.createBid(deps, CA1, recurring.id, { proposedAmount: 1 }), 409);
    okR("paused posting rejects submit of an existing draft", await svc.submitBid(deps, CA3, bidA3draft.id), 409);
    await svc.transitionPost(deps, ADMIN_A, recurring.id, "reopen");
    okR("withdraw before award", (r = await svc.withdrawBid(deps, CA3, bidA3draft.id)), 200);
    ok("withdrawn", r.body.status === "withdrawn");
    okR("after withdrawing, a fresh bid is allowed", (r = await svc.createBid(deps, CA3, recurring.id, { proposedAmount: 120 })), 201);
    const bidA3 = r.body;
    await svc.submitBid(deps, CA3, bidA3.id);

    // ── Material edit after publication ─────────────────────────────────────
    const notesBefore = Number((await pool.query(`SELECT count(*) FROM contractor_notifications WHERE notification_type = 'job_post_changed' AND company_id = $1`, [ids.coA])).rows[0].count);
    okR("admin edits scope of a published posting", await svc.updatePost(deps, ADMIN_A, oneTime.id, { scopeOfWork: "Lobby walls and ceiling" }), 200);
    const notesAfter = Number((await pool.query(`SELECT count(*) FROM contractor_notifications WHERE notification_type = 'job_post_changed' AND company_id = $1`, [ids.coA])).rows[0].count);
    ok("material change notified both active bidders", notesAfter - notesBefore === 2);
    ok("material change audited", (await pool.query(`SELECT 1 FROM contractor_job_bid_events WHERE job_post_id = $1 AND event_type = 'post_material_change'`, [oneTime.id])).rows.length === 1);
    okR("title-only edit is not material", await svc.updatePost(deps, ADMIN_A, oneTime.id, { title: "Paint lobby (v2)" }), 200);
    ok("…and writes no second material event", (await pool.query(`SELECT 1 FROM contractor_job_bid_events WHERE job_post_id = $1 AND event_type = 'post_material_change'`, [oneTime.id])).rows.length === 1);

    // ── 15. Suspended tenant ────────────────────────────────────────────────
    console.log("suspended tenant");
    suspended.add(ids.coA);
    okR("suspended: cannot create a posting", await svc.createPost(deps, ADMIN_A, ids.coA, { title: "x" }), 403);
    okR("suspended: cannot award", await svc.awardBid(deps, ADMIN_A, bidA1.id, "k-susp"), 403);
    okR("suspended: contractor cannot bid", await svc.createBid(deps, CA1, capped.id, { proposedAmount: 1 }), 403);
    ok("suspended: available list is empty", (await svc.listAvailablePosts(deps, CA1) as any).body.length === 0);
    ok("suspended award attempt left no proposal and no key", (await pool.query(`SELECT award_idempotency_key, status FROM contractor_job_bids WHERE id = $1`, [bidA1.id])).rows[0].award_idempotency_key === null);
    suspended.delete(ids.coA);

    // ── 9/10/12. Award (one-time, idempotent, concurrent) ───────────────────
    console.log("award");
    okR("award without Idempotency-Key is a 400", await svc.awardBid(deps, ADMIN_A, bidA1.id, ""), 400);
    const [x1, x2] = await Promise.all([
      svc.awardBid(deps, ADMIN_A, bidA1.id, `key-a1-${sfx}`),
      svc.awardBid(deps, ADMIN_A, bidA2.id, `key-a2-${sfx}`),
    ]) as any[];
    const winners = [x1, x2].filter((x) => x.ok);
    ok(`concurrent awards on a one-time posting: exactly one wins (${x1.status}/${x2.status})`, winners.length === 1 && [x1, x2].some((x) => x.status === 409));
    const win = winners[0].body;
    const winKey = win.bid.id === bidA1.id ? `key-a1-${sfx}` : `key-a2-${sfx}`;
    ok("one-time posting closed at its limit", win.post.status === "closed" && win.post.awardsMade === 1);
    const replay = await svc.awardBid(deps, ADMIN_A, win.bid.id, winKey) as any;
    ok("retry with the same key replays (200, same proposal)", replay.status === 200 && replay.body.replayed === true && replay.body.proposalId === win.proposalId);
    okR("same bid, different key → 409", await svc.awardBid(deps, ADMIN_A, win.bid.id, `other-${sfx}`), 409);
    const props = (await pool.query(`SELECT * FROM contractor_proposals WHERE job_bid_id = $1`, [win.bid.id])).rows;
    ok("exactly one proposal for the awarded bid", props.length === 1);
    const prop = props[0];
    const winWorker = win.bid.id === bidA1.id ? ids.cA1 : ids.cA2;
    ok("proposal keeps company, contractor, posting + bid linkage", prop.company_id === ids.coA && prop.contractor_id === winWorker && prop.job_post_id === oneTime.id && prop.job_bid_id === win.bid.id);
    ok("proposal.job_id is the posting's cost job (not the posting id)", prop.job_id === ids.jobA);
    ok("proposal starts as a contractor-review draft", prop.status === "draft");
    ok("proposal amount copied from the awarded terms", win.bid.id === bidA1.id ? prop.amount === "3900.00" : prop.amount === "4400.00");
    ok("proposal created event recorded", (await pool.query(`SELECT 1 FROM proposal_approval_events WHERE proposal_id = $1 AND event_type = 'created'`, [prop.id])).rows.length === 1);
    let dup = false;
    try { await pool.query(`INSERT INTO contractor_proposals (contractor_id, issue_date, job_bid_id) VALUES ($1, '2026-01-01', $2)`, [ids.cA1, win.bid.id]); } catch { dup = true; }
    ok("DB rejects a second proposal for the same bid (uq_contractor_proposals_job_bid_id)", dup);
    const winnerUser = win.bid.id === bidA1.id ? ids.uA1 : ids.uA2;
    const awardNote = (await pool.query(`SELECT title, body FROM contractor_notifications WHERE notification_type = 'job_bid_awarded' AND user_id = $1`, [winnerUser])).rows;
    ok("winner notified once, without amounts", awardNote.length === 1 && !/\d{3}/.test(awardNote[0].title + awardNote[0].body));
    okR("closed posting rejects new bids", await svc.createBid(deps, CA3, oneTime.id, { proposedAmount: 1 }), 409);

    // ── 11. Recurring stays open; each award its own proposal ───────────────
    console.log("recurring awards");
    r = await svc.createBid(deps, CA1, recurring.id, { proposedAmount: 90 }); await svc.submitBid(deps, CA1, r.body.id);
    const recBidA1 = r.body.id;
    r = await svc.awardBid(deps, ADMIN_A, bidA3.id, `rec-1-${sfx}`) as any;
    ok("first recurring award succeeds and posting stays published", r.status === 201 && r.body.post.status === "published" && r.body.post.awardsMade === 1);
    r = await svc.awardBid(deps, ADMIN_A, recBidA1, `rec-2-${sfx}`) as any;
    ok("second recurring award succeeds, still published", r.status === 201 && r.body.post.status === "published" && r.body.post.awardsMade === 2);
    const recProps = (await pool.query(`SELECT id, contractor_id, company_id FROM contractor_proposals WHERE job_post_id = $1`, [recurring.id])).rows;
    ok("two separate proposals, one per contractor, both company A", recProps.length === 2 && new Set(recProps.map((p: any) => p.contractor_id)).size === 2 && recProps.every((p: any) => p.company_id === ids.coA));
    ok("recurring award copies no cost job when none set", (await pool.query(`SELECT job_id FROM contractor_proposals WHERE job_post_id = $1`, [recurring.id])).rows.every((p: any) => p.job_id === null));

    // Capped recurring: 2 awards then closed.
    const cb1 = (await svc.createBid(deps, CA1, capped.id, { proposedAmount: 10 }) as any).body.id; await svc.submitBid(deps, CA1, cb1);
    const cb2 = (await svc.createBid(deps, CA2, capped.id, { proposedAmount: 11 }) as any).body.id; await svc.submitBid(deps, CA2, cb2);
    const cb3 = (await svc.createBid(deps, CA3, capped.id, { proposedAmount: 12 }) as any).body.id; await svc.submitBid(deps, CA3, cb3);
    r = await svc.awardBid(deps, ADMIN_A, cb1, `cap-1-${sfx}`) as any;
    ok("capped recurring: first award keeps it open", r.body.post.status === "published");
    r = await svc.awardBid(deps, ADMIN_A, cb2, `cap-2-${sfx}`) as any;
    ok("capped recurring: second award reaches capacity and closes", r.body.post.status === "closed" && r.body.post.closeReason === "award_capacity_reached");
    okR("capped recurring: third award refused", await svc.awardBid(deps, ADMIN_A, cb3, `cap-3-${sfx}`), 409);
    okR("cannot reopen at capacity", await svc.transitionPost(deps, ADMIN_A, capped.id, "reopen"), 409);
    okR("raise the limit while closed? closed postings are locked", await svc.updatePost(deps, ADMIN_A, capped.id, { maximumAwards: 3 }), 409);

    // ── 13. Attachments ─────────────────────────────────────────────────────
    console.log("attachments");
    const file = (name: string) => ({ originalname: name, mimetype: "application/pdf", size: 9, buffer: Buffer.from("%PDF-1.4\n") });
    okR("html upload refused", await svc.addPostAttachment(deps, ADMIN_A, recurring.id, { ...file("x.html"), mimetype: "text/html" }), 400);
    r = await svc.addPostAttachment(deps, ADMIN_A, recurring.id, file("spec.pdf")); okR("admin attaches a spec to the posting", r, 201);
    const postAtt = r.body.id;
    const stored = (await pool.query(`SELECT storage_key FROM contractor_job_attachments WHERE id = $1`, [postAtt])).rows[0].storage_key;
    ok("stored in the private store, not /uploads", !stored.includes("uploads") && fs.existsSync(path.join(storeDir, stored)));
    ok("stored file is owner-only (0600)", (fs.statSync(path.join(storeDir, stored)).mode & 0o777) === 0o600);
    okR("eligible contractor downloads the posting attachment", await svc.authorizeAttachmentDownload(deps, CA2, postAtt), 200);
    okR("other-company contractor cannot", await svc.authorizeAttachmentDownload(deps, CB1, postAtt), 404);
    okR("other-company admin cannot", await svc.authorizeAttachmentDownload(deps, ADMIN_B, postAtt), 404);
    const draftBid = (await svc.createBid(deps, CA2, recurring.id, { proposedAmount: 5 }) as any).body.id;
    r = await svc.addBidAttachment(deps, CA2, draftBid, file("quote.pdf")); okR("contractor attaches a quote to own bid", r, 201);
    const bidAtt = r.body.id;
    okR("another contractor cannot attach to it", await svc.addBidAttachment(deps, CA1, draftBid, file("x.pdf")), 404);
    okR("another contractor cannot download it", await svc.authorizeAttachmentDownload(deps, CA1, bidAtt), 404);
    okR("admin cannot see an unsent draft's attachment", await svc.authorizeAttachmentDownload(deps, ADMIN_A, bidAtt), 404);
    await svc.submitBid(deps, CA2, draftBid);
    okR("admin can after submission", await svc.authorizeAttachmentDownload(deps, ADMIN_A, bidAtt), 200);
    okR("admin B never can", await svc.authorizeAttachmentDownload(deps, ADMIN_B, bidAtt), 404);
    okR("contractor removes own attachment (soft)", await svc.removeAttachment(deps, CA2, bidAtt), 200);
    ok("removal is soft — row and file retained", (await pool.query(`SELECT removed_at FROM contractor_job_attachments WHERE id = $1`, [bidAtt])).rows[0].removed_at !== null);
    okR("removed attachment no longer downloadable", await svc.authorizeAttachmentDownload(deps, CA2, bidAtt), 404);

    // ── Questions ───────────────────────────────────────────────────────────
    console.log("questions");
    const q1 = (await svc.askQuestion(deps, CA1, recurring.id, "Is parking provided?") as any).body;
    const q2 = (await svc.askQuestion(deps, CA2, recurring.id, "Private question") as any).body;
    okR("B1 cannot ask on A's posting", await svc.askQuestion(deps, CB1, recurring.id, "hi"), 404);
    okR("admin answers publicly", await svc.answerQuestion(deps, ADMIN_A, q1.id, { answer: "Yes", isPublic: true }), 200);
    okR("admin B cannot answer", await svc.answerQuestion(deps, ADMIN_B, q2.id, { answer: "x" }), 404);
    const a3q = (await svc.listQuestions(deps, CA3, recurring.id) as any).body;
    ok("other contractors see only public answered questions, without the asker", a3q.length === 1 && a3q[0].id === q1.id && a3q[0].contractorId === undefined);
    ok("A2 sees own private question + the public one", (await svc.listQuestions(deps, CA2, recurring.id) as any).body.length === 2);
    ok("admin sees all with askers", (await svc.listQuestions(deps, ADMIN_A, recurring.id) as any).body.every((q: any) => !!q.contractorId));

    // ── 14/16. Audit trail ──────────────────────────────────────────────────
    console.log("audit");
    const evTypes = new Set((await pool.query(`SELECT DISTINCT event_type FROM contractor_job_bid_events WHERE company_id = $1`, [ids.coA])).rows.map((e: any) => e.event_type));
    for (const t of ["post_created", "post_published", "post_paused", "post_reopened", "post_closed", "post_updated", "post_material_change",
      "contractor_invited", "contractor_invitation_revoked", "bid_created", "bid_draft_updated", "bid_submitted", "bid_revised",
      "bid_revision_requested", "bid_resubmitted", "bid_under_review", "bid_shortlisted", "bid_withdrawn", "bid_awarded",
      "bid_converted_to_proposal", "question_asked", "question_answered", "post_attachment_added", "bid_attachment_added", "attachment_removed"]) {
      ok(`event recorded: ${t}`, evTypes.has(t));
    }
    ok("every A event carries company A + tenant A", (await pool.query(`SELECT count(*)::int c FROM contractor_job_bid_events WHERE company_id = $1 AND tenant_id IS DISTINCT FROM $2`, [ids.coA, tenantA])).rows[0].c === 0);
    let immut = false;
    try { await pool.query(`UPDATE contractor_job_bid_events SET event_type = 'x' WHERE company_id = $1`, [ids.coA]); } catch { immut = true; }
    ok("events cannot be updated (trigger)", immut);
    immut = false;
    try { await pool.query(`UPDATE contractor_job_bid_versions SET revision_number = 99 WHERE company_id = $1`, [ids.coA]); } catch { immut = true; }
    ok("bid versions cannot be updated (trigger)", immut);
    ok("admin event feed is company-scoped", (await svc.listPostEvents(deps, ADMIN_B, oneTime.id) as any).status === 404);

    // ── Tenant consistency (company re-parented) → unreachable ──────────────
    await pool.query(`UPDATE tenant_companies SET tenant_id = $1 WHERE company_id = $2`, [tenantB, ids.coA]);
    okR("posting stamped with tenant A is unreachable once company A maps to tenant B", await svc.getPost(deps, ADMIN_A, recurring.id), 404);
    await pool.query(`UPDATE tenant_companies SET tenant_id = $1 WHERE company_id = $2`, [tenantA, ids.coA]);

    // ── Notifications ───────────────────────────────────────────────────────
    const leak = (await pool.query(
      `SELECT count(*)::int c FROM contractor_notifications WHERE company_id IN ($1,$2) AND (title ~ '[0-9]{3}' OR body ~ '[0-9]{3}')`, [ids.coA, ids.coB])).rows[0].c;
    ok("no notification body/title carries an amount", leak === 0);
    ok("company B contractor received no company A notifications", (await pool.query(`SELECT count(*)::int c FROM contractor_notifications WHERE user_id = $1 AND company_id IS DISTINCT FROM $2`, [ids.uB1, ids.coB])).rows[0].c === 0);
    ok("…but was notified of company B's own new posting", (await pool.query(`SELECT count(*)::int c FROM contractor_notifications WHERE user_id = $1 AND notification_type = 'job_published'`, [ids.uB1])).rows[0].c === 1);
    ok("employees are never notified of job postings", (await pool.query(`SELECT count(*)::int c FROM contractor_notifications WHERE worker_id = $1`, [ids.empA])).rows[0].c === 0);

    // ── Dashboard summaries ─────────────────────────────────────────────────
    const sum = (await svc.adminSummary(deps, ADMIN_A, ids.coA) as any).body;
    ok("admin summary counts (awards this month ≥ 5)", sum.awardsThisMonth >= 5 && typeof sum.publishedJobs === "number");
    okR("admin B cannot read A's summary", await svc.adminSummary(deps, ADMIN_B, ids.coA), 404);

    // ── Maintenance worker ──────────────────────────────────────────────────
    console.log("maintenance");
    r = await svc.createPost(deps, ADMIN_A, ids.coA, { title: "Fixed term", summary: "s", workType: "recurring", recurrenceFrequency: "weekly", estimatedStartDate: "2026-01-01", estimatedEndDate: "2026-06-30" });
    const fixedTerm = r.body; postIds.push(fixedTerm.id);
    await pool.query(`UPDATE contractor_job_posts SET status = 'published', published_at = now() WHERE id = $1`, [fixedTerm.id]);
    // A contract for the first recurring award's proposal.
    const recProp = recProps[0];
    await pool.query(`INSERT INTO contractor_contracts (company_id, contractor_id, proposal_id, title) VALUES ($1,$2,$3,'ZZ JB contract')`, [ids.coA, recProp.contractor_id, recProp.id]);
    // A draft bid on a posting closing within 24h.
    r = await svc.createPost(deps, ADMIN_A, ids.coA, { title: "Closing soon", summary: "s", submissionDeadline: new Date(Date.now() + 6 * 3600e3).toISOString() });
    const soon = r.body; postIds.push(soon.id);
    await svc.transitionPost(deps, ADMIN_A, soon.id, "publish");
    await svc.createBid(deps, CA1, soon.id, { proposedAmount: 1 });
    const m1 = await svc.runJobBoardMaintenance(pool, new Date("2026-11-13T12:00:00Z"));
    const m1Now = await svc.runJobBoardMaintenance(pool);
    ok(`maintenance closes expired fixed-term recurring (${m1.expired})`, m1.expired >= 1 &&
      (await pool.query(`SELECT status, close_reason FROM contractor_job_posts WHERE id = $1`, [fixedTerm.id])).rows[0].close_reason === "end_date_passed");
    ok(`maintenance links the awarded bid to its contract (${m1.contractsLinked})`, m1.contractsLinked >= 1 &&
      (await pool.query(`SELECT status, converted_contract_id FROM contractor_job_bids WHERE converted_proposal_id = $1`, [recProp.id])).rows[0].status === "converted_to_contract");
    ok(`deadline reminder sent once (${m1.deadlineReminders + m1Now.deadlineReminders})`, (await pool.query(`SELECT count(*)::int c FROM contractor_job_bid_events WHERE job_post_id = $1 AND event_type = 'deadline_reminder_sent'`, [soon.id])).rows[0].c === 1);
    const m2 = await svc.runJobBoardMaintenance(pool);
    ok("maintenance is idempotent (second run changes nothing for these rows)", m2.contractsLinked === 0 && (await pool.query(`SELECT count(*)::int c FROM contractor_job_bid_events WHERE job_post_id = $1 AND event_type = 'deadline_reminder_sent'`, [soon.id])).rows[0].c === 1 && (await pool.query(`SELECT count(*)::int c FROM contractor_job_bid_events WHERE job_post_id = $1 AND event_type = 'post_closed'`, [fixedTerm.id])).rows[0].c === 1);
    okR("cannot reopen a fixed-term posting past its end date", await svc.transitionPost(deps, ADMIN_A, fixedTerm.id, "reopen"), 409);

    // ── Archive (soft) ──────────────────────────────────────────────────────
    okR("closed posting archives", await svc.transitionPost(deps, ADMIN_A, fixedTerm.id, "archive"), 200);
    ok("archived posting still exists (soft delete)", (await pool.query(`SELECT archived_at FROM contractor_job_posts WHERE id = $1`, [fixedTerm.id])).rows[0].archived_at !== null);
    ok("archived hidden from the default admin list", !(await svc.listPostsForAdmin(deps, ADMIN_A, ids.coA) as any).body.some((p: any) => p.id === fixedTerm.id));
  } finally {
    const co = [ids.coA, ids.coB];
    const q = (s: string, p: unknown[] = [co]) => pool.query(s, p).catch((e) => console.error("cleanup:", e.message));
    await q(`DELETE FROM contractor_notifications WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM contractor_job_attachments WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM contractor_job_questions WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM contractor_job_invitations WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM contractor_job_bid_events WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM contractor_job_bid_versions WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM contractor_contracts WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM proposal_approval_events WHERE proposal_id IN (SELECT id FROM contractor_proposals WHERE company_id = ANY($1::varchar[]))`);
    await q(`DELETE FROM contractor_proposals WHERE company_id = ANY($1::varchar[]) OR contractor_id IN (SELECT id FROM workers WHERE company_id = ANY($1::varchar[]))`);
    await q(`DELETE FROM contractor_job_bids WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM contractor_job_posts WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM users WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM jobs WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM workers WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM tenant_companies WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM tenants WHERE id = ANY($1::varchar[])`, [[tenantA, tenantB].filter(Boolean)]);
    await q(`DELETE FROM companies WHERE id = ANY($1::varchar[])`);
    const left = await pool.query(`SELECT (SELECT count(*) FROM companies WHERE id = ANY($1::varchar[])) + (SELECT count(*) FROM contractor_job_posts WHERE company_id = ANY($1::varchar[])) AS n`, [co]);
    console.log(`cleanup: ${Number(left.rows[0].n) === 0 ? "zero residue" : "RESIDUE " + left.rows[0].n}`);
    await pool.end();
    fs.rmSync(storeDir, { recursive: true, force: true });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
