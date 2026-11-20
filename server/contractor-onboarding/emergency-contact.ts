/**
 * Contractor onboarding — PR 5: emergency contact.
 *
 * Reuses existing storage (no migration): the worker's primary emergency row in
 * employee_contacts (name, relationship, phone, optional email) and the mirrored
 * workers.emergency_contact_name / emergency_contact_phone shown on My Profile.
 * One transaction, serialized per worker; saving the same values twice changes
 * nothing and writes one audit event per real change. Audit rows never hold
 * the contact's values.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";

export interface EmergencyContact { name: string; relationship: string; phone: string; email: string | null }
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const firstRow = <T>(r: any): T | undefined => (Array.isArray(r) ? r[0] : r?.rows?.[0]);

export function normalizeEmergencyContact(body: unknown): { ok: true; value: EmergencyContact } | { ok: false; message: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");
  const name = str(b.name), relationship = str(b.relationship), rawPhone = str(b.phone);
  const email = typeof b.email === "string" && b.email.trim() ? b.email.trim().toLowerCase() : null;
  if (!name || !relationship || !rawPhone) return { ok: false, message: "Name, relationship and phone number are required." };
  if (name.length > 100 || relationship.length > 50) return { ok: false, message: "Name must be 100 characters or fewer and relationship 50 or fewer." };
  if (CONTROL_RE.test(name) || CONTROL_RE.test(relationship)) return { ok: false, message: "The name or relationship contains characters that are not allowed." };
  if (!/^[+()\d\s.-]{7,25}$/.test(rawPhone)) return { ok: false, message: "Enter a phone number using digits (and + ( ) - if needed)." };
  const digits = rawPhone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return { ok: false, message: "Enter a phone number with 7 to 15 digits." };
  const phone = (rawPhone.startsWith("+") ? "+" : "") + digits;
  if (email && (email.length > 254 || !EMAIL_RE.test(email))) return { ok: false, message: "Enter a valid email address or leave it blank." };
  return { ok: true, value: { name, relationship, phone, email } };
}

export async function getEmergencyContact(companyId: string, workerId: string): Promise<EmergencyContact | null> {
  const r = firstRow<any>(await db.execute(sql`
    SELECT c.name, c.relationship, c.phone, c.email
      FROM employee_contacts c JOIN workers w ON w.id = c.worker_id
     WHERE c.worker_id = ${workerId} AND w.company_id = ${companyId} AND c.contact_type = 'emergency'
     ORDER BY c.is_primary DESC NULLS LAST, c.created_at DESC LIMIT 1`));
  return r ? { name: r.name, relationship: r.relationship ?? "", phone: r.phone ?? "", email: r.email ?? null } : null;
}

export async function saveEmergencyContact(args: {
  companyId: string; workerId: string; onboardingId: string | null; actorUserId: string; actorType: "worker" | "admin"; value: EmergencyContact;
}): Promise<{ changed: boolean }> {
  const { companyId, workerId, value } = args;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`emergency-contact:${workerId}`}))`);
    const w = firstRow<any>(await tx.execute(sql`SELECT id FROM workers WHERE id = ${workerId} AND company_id = ${companyId} FOR UPDATE`));
    if (!w) throw new Error("worker not in company");
    const cur = firstRow<any>(await tx.execute(sql`
      SELECT id, name, relationship, phone, email FROM employee_contacts
       WHERE worker_id = ${workerId} AND contact_type = 'emergency' ORDER BY is_primary DESC NULLS LAST, created_at DESC LIMIT 1`));
    const same = cur && cur.name === value.name && (cur.relationship ?? "") === value.relationship && (cur.phone ?? "") === value.phone && (cur.email ?? null) === value.email;
    if (!same) {
      if (cur) {
        await tx.execute(sql`UPDATE employee_contacts SET name = ${value.name}, relationship = ${value.relationship}, phone = ${value.phone}, email = ${value.email}, is_primary = true WHERE id = ${cur.id}`);
      } else {
        await tx.execute(sql`INSERT INTO employee_contacts (worker_id, contact_type, name, relationship, phone, email, is_primary) VALUES (${workerId}, 'emergency', ${value.name}, ${value.relationship}, ${value.phone}, ${value.email}, true)`);
      }
      await tx.execute(sql`UPDATE workers SET emergency_contact_name = ${value.name}, emergency_contact_phone = ${value.phone} WHERE id = ${workerId} AND company_id = ${companyId}`);
    }
    if (args.onboardingId) {
      const step = firstRow<any>(await tx.execute(sql`
        UPDATE onboarding_steps SET status = 'completed', completed_at = COALESCE(completed_at, NOW()), updated_at = NOW()
         WHERE onboarding_id = ${args.onboardingId} AND company_id = ${companyId} AND step_key = 'emergency_contact'
        RETURNING id`));
      if (!same) {
        await tx.execute(sql`
          INSERT INTO onboarding_audit_log (company_id, worker_id, onboarding_id, step_id, actor_user_id, actor_type, event_type, after_json)
          VALUES (${companyId}, ${workerId}, ${args.onboardingId}, ${step?.id ?? null}, ${args.actorUserId}, ${args.actorType},
                  ${cur ? "emergency_contact_updated" : "emergency_contact_added"}, ${JSON.stringify({ hasEmail: !!value.email })})`);
      }
    }
    return { changed: !same };
  });
}
