/**
 * Documenso Integration Service
 *
 * Server-side only integration with the Documenso v2 REST API. Secrets are read
 * from environment/Replit Secrets and are never returned to the browser.
 */
import crypto from "crypto";

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function getDocumensoBaseUrlInfo(): { apiBaseUrl: string; publicBaseUrl: string; source: string | null; configured: boolean } {
  const candidates: Array<[string, string | undefined]> = [
    ["DOCUMENSO_URL", process.env.DOCUMENSO_URL],
    ["MYPAYLINK_DOCUMENSO_BASE_URL", process.env.MYPAYLINK_DOCUMENSO_BASE_URL],
    ["DOCUMENSO_BASE_URL", process.env.DOCUMENSO_BASE_URL],
  ];
  const selected = candidates.find(([, value]) => !!value?.trim());
  if (!selected) return { apiBaseUrl: "", publicBaseUrl: "", source: null, configured: false };
  const normalized = normalizeBaseUrl(selected[1]!.trim());
  const publicBaseUrl = normalized.replace(/\/api\/v2$/, "");
  const apiBaseUrl = normalized.endsWith("/api/v2") ? normalized : `${normalized}/api/v2`;
  return { apiBaseUrl, publicBaseUrl, source: selected[0], configured: true };
}

function getBaseUrl(): string {
  const info = getDocumensoBaseUrlInfo();
  if (!info.configured) throw new Error("Documenso is not configured. Set DOCUMENSO_URL in environment settings.");
  return info.apiBaseUrl;
}

function getApiKey(): string {
  const key = (process.env.MYPAYLINK_DOCUMENSO_API_KEY || process.env.MyPayLink_DOCUMENSO_API_KEY || process.env.DOCUMENSO_API_KEY || "").trim();
  if (!key || key === "REPLIT_SECRET_ONLY") {
    throw new Error("Documenso is not configured. Set MYPAYLINK_DOCUMENSO_API_KEY in environment settings.");
  }
  return key;
}

export function isDocumensoEnabled(): boolean {
  return String(process.env.MYPAYLINK_DOCUMENSO_ENABLED || process.env.DOCUMENSO_ENABLED || "true").toLowerCase() !== "false";
}

export function validateDocumensoConfig(): { ok: boolean; message?: string; baseUrl: string; apiKeyConfigured?: boolean; webhookSecretConfigured?: boolean } {
  try {
    if (!isDocumensoEnabled()) return { ok: false, message: "Documenso signing is disabled", baseUrl: getDocumensoBaseUrlInfo().apiBaseUrl, apiKeyConfigured: false, webhookSecretConfigured: !!(process.env.DOCUMENSO_WEBHOOK_SECRET || process.env.MYPAYLINK_DOCUMENSO_WEBHOOK_SECRET) };
    getApiKey();
    const baseInfo = getDocumensoBaseUrlInfo();
    if (!baseInfo.configured) throw new Error("Documenso is not configured. Set DOCUMENSO_URL in environment settings.");
    return { ok: true, baseUrl: baseInfo.apiBaseUrl, apiKeyConfigured: true, webhookSecretConfigured: !!(process.env.DOCUMENSO_WEBHOOK_SECRET || process.env.MYPAYLINK_DOCUMENSO_WEBHOOK_SECRET) };
  } catch (error: any) {
    const baseInfo = getDocumensoBaseUrlInfo();
    return { ok: false, message: error?.message || "Documenso configuration is invalid", baseUrl: baseInfo.apiBaseUrl, apiKeyConfigured: false, webhookSecretConfigured: !!(process.env.DOCUMENSO_WEBHOOK_SECRET || process.env.MYPAYLINK_DOCUMENSO_WEBHOOK_SECRET) };
  }
}

async function parseResponse(res: Response): Promise<any> {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  return res.text();
}

export class DocumensoApiError extends Error {
  status: number;
  code?: string | null;
  body: any;
  requestId?: string | null;
  endpoint: string;
  method: string;
  timestamp: string;

  constructor(method: string, endpoint: string, status: number, body: any, requestId?: string | null) {
    const message = typeof body === "string" ? body : (body?.message || body?.error || body?.code || JSON.stringify(body));
    super(`Documenso API ${method} ${endpoint} failed with ${status}: ${message}`);
    this.name = "DocumensoApiError";
    this.method = method;
    this.endpoint = endpoint;
    this.status = status;
    this.code = typeof body === "object" ? (body?.code || body?.errorCode || body?.error) : null;
    this.body = body;
    this.requestId = requestId || null;
    this.timestamp = new Date().toISOString();
  }
}

export function serializeDocumensoError(error: any) {
  return {
    httpStatus: error?.status || null,
    errorCode: error?.code || null,
    errorMessage: error?.message || "Documenso request failed",
    responseBody: error?.body ?? null,
    requestId: error?.requestId || null,
    timestamp: error?.timestamp || new Date().toISOString(),
  };
}

async function apiJson<T = any>(method: string, endpoint: string, body?: any): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${endpoint}`, {
    method,
    headers: {
      Authorization: getApiKey(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await parseResponse(res).catch(() => "");
    throw new DocumensoApiError(method, endpoint, res.status, err, res.headers.get("x-request-id") || res.headers.get("x-correlation-id"));
  }
  return parseResponse(res) as Promise<T>;
}

export interface DocumensoRecipient {
  name: string;
  email: string;
  role?: "SIGNER" | "VIEWER" | "APPROVER" | "CC" | string;
  routingOrder?: number;
}

export interface DocumensoField {
  identifier?: number | string;
  type: "SIGNATURE" | "INITIALS" | "NAME" | "EMAIL" | "DATE" | "TEXT" | "NUMBER" | "CHECKBOX" | "RADIO" | "DROPDOWN" | string;
  page?: number;
  positionX?: number;
  positionY?: number;
  width?: number;
  height?: number;
}

export interface CreateDocumensoDocumentOptions {
  title: string;
  pdfBuffer: Buffer;
  recipients: DocumensoRecipient[];
  metadata?: Record<string, string>;
  subject?: string;
  message?: string;
  returnUrl?: string;
  fields?: DocumensoField[];
}

export interface DocumensoDocumentResult {
  documentId: string;
  status: string;
  signingLinks: Array<{ id?: string | null; name: string; email: string; role?: string | null; signingUrl?: string; token?: string; status?: string }>;
  auditUrl?: string;
  rawResponse: any;
}

function defaultFieldsForRecipient(index: number): DocumensoField[] {
  const y = Math.max(72, 82 - index * 8);
  return [
    { identifier: 0, type: "SIGNATURE", page: 1, positionX: 10, positionY: y, width: 28, height: 6 },
    { identifier: 0, type: "DATE", page: 1, positionX: 44, positionY: y, width: 18, height: 4 },
  ];
}

function mapDocumensoStatus(status: string | undefined | null): string {
  const s = String(status || "draft").toUpperCase();
  if (s === "PENDING") return "sent";
  if (s === "COMPLETED") return "completed";
  if (s === "REJECTED") return "rejected";
  if (s === "VOIDED" || s === "DELETED") return "voided";
  if (s === "DRAFT") return "draft";
  return s.toLowerCase();
}

export function toLocalDocumensoStatus(status: string | undefined | null): string {
  return mapDocumensoStatus(status);
}

export async function createDocumensoDocument({
  title,
  pdfBuffer,
  recipients,
  metadata,
  subject,
  message,
  returnUrl,
  fields,
}: CreateDocumensoDocumentOptions): Promise<DocumensoDocumentResult> {
  if (!recipients.length) throw new Error("At least one Documenso recipient is required");

  const payload = {
    type: "DOCUMENT",
    title,
    externalId: metadata?.externalId,
    visibility: "EVERYONE",
    recipients: recipients.map((recipient, index) => ({
      email: recipient.email,
      name: recipient.name,
      role: recipient.role || "SIGNER",
      signingOrder: recipient.routingOrder ?? index + 1,
      fields: fields?.length ? fields : defaultFieldsForRecipient(index),
    })),
    meta: {
      subject: subject || `Please sign: ${title}`,
      message: message || `Please review and sign ${title}.`,
      redirectUrl: returnUrl,
      timezone: "America/New_York",
    },
    metadata,
  };

  const form = new FormData();
  form.append("payload", JSON.stringify(payload));
  form.append("files", new Blob([pdfBuffer], { type: "application/pdf" }), `${title.replace(/[^a-z0-9._-]+/gi, "-") || "document"}.pdf`);

  const createRes = await fetch(`${getBaseUrl()}/envelope/create`, {
    method: "POST",
    headers: { Authorization: getApiKey(), Accept: "application/json" },
    body: form,
  });
  if (!createRes.ok) {
    const err = await parseResponse(createRes).catch(() => "");
    throw new Error(`Documenso create failed with ${createRes.status}: ${typeof err === "string" ? err : JSON.stringify(err)}`);
  }
  const createdRaw = await parseResponse(createRes);
  const created = unwrapDocumensoEnvelope(createdRaw);
  const documentId = String(created?.id || created?.envelopeId || created?.documentId || "");
  if (!documentId) throw new Error(`Documenso returned no document id: ${JSON.stringify(createdRaw)}`);

  const distributedRaw = await apiJson<any>("POST", "/envelope/distribute", {
    envelopeId: documentId,
    meta: payload.meta,
  });
  const distributed = unwrapDocumensoEnvelope(distributedRaw);

  return {
    documentId,
    status: mapDocumensoStatus(distributed?.status || distributed?.envelope?.status || "PENDING"),
    signingLinks: (distributed?.recipients || []).map((r: any) => ({
      id: r.id != null ? String(r.id) : null,
      name: r.name || "",
      email: r.email || "",
      role: r.role ?? null,
      signingUrl: r.signingUrl || (r.token ? `${getDocumensoBaseUrlInfo().publicBaseUrl}/sign/${r.token}` : undefined),
      token: r.token,
      status: r.signingStatus || r.status,
    })),
    auditUrl: `${getBaseUrl()}/envelope/${documentId}/audit-log`,
    rawResponse: { created: createdRaw, distributed: distributedRaw },
  };
}

/**
 * Unwrap a possible `{ data: {...} }` envelope wrapper. A prior fix attempt
 * (see the dead `remote?.rawResponse?.data?.recipients` fallback branch this
 * repair removes the need for, in routes.ts's extractDocumensoRecipients)
 * already suspected the live API wraps responses this way, but patched the
 * wrong layer — the actual unwrapped array never reached that fallback,
 * because this function always returned an array (possibly empty) for
 * `.recipients`, which made `Array.isArray(remote.recipients)` always true
 * upstream and short-circuited before the fallback could ever run. Fixing it
 * here, at the source, is the smallest complete repair.
 */
function unwrapDocumensoEnvelope(doc: any): any {
  return doc?.data && typeof doc.data === "object" ? doc.data : doc;
}

/**
 * Merge additional recipient pages if the response signals more exist than
 * were returned on this page. Follows a conventional cursor shape
 * (`nextCursor`/`next_cursor` at the top level or under `pagination`/`meta`).
 * No-ops safely (returns the single page as-is) when no such signal is
 * present, so this can never introduce a new failure mode for the common
 * (non-paginated) case.
 */
async function fetchAllDocumensoRecipientPages(documentId: string, firstPageEnvelope: any): Promise<any[]> {
  const recipientsFromPage = (envelope: any): any[] =>
    Array.isArray(envelope?.recipients) ? envelope.recipients : [];
  const nextCursorOf = (envelope: any): string | null =>
    envelope?.nextCursor || envelope?.next_cursor || envelope?.pagination?.nextCursor || envelope?.meta?.nextCursor || null;

  // Keyed by recipient id (falling back to array position for recipients
  // without one) so a repeated/non-advancing cursor that re-returns the same
  // page can never produce duplicate entries.
  const merged = new Map<string, any>();
  const addPage = (recipients: any[]) => {
    recipients.forEach((r, i) => merged.set(r?.id != null ? String(r.id) : `__idx_${merged.size + i}`, r));
  };

  addPage(recipientsFromPage(firstPageEnvelope));
  let cursor = nextCursorOf(firstPageEnvelope);
  let pagesFetched = 1;
  const MAX_PAGES = 20; // hard cap — never loop forever on a malformed/cyclical cursor
  while (cursor && pagesFetched < MAX_PAGES) {
    let page: any;
    try {
      page = await apiJson<any>("GET", `/envelope/${encodeURIComponent(documentId)}?cursor=${encodeURIComponent(cursor)}`);
    } catch {
      break; // a failed subsequent page fetch must not discard the pages already collected
    }
    const envelope = unwrapDocumensoEnvelope(page);
    const next = nextCursorOf(envelope);
    if (!next || next === cursor) {
      // Non-advancing/cyclical cursor — this is the last usable page; merge
      // it (by id, so a repeated page can't duplicate) and stop.
      addPage(recipientsFromPage(envelope));
      break;
    }
    addPage(recipientsFromPage(envelope));
    cursor = next;
    pagesFetched++;
  }
  return [...merged.values()];
}

export async function getDocumensoDocument(documentId: string) {
  const doc = await apiJson<any>("GET", `/envelope/${encodeURIComponent(documentId)}`);
  const envelope = unwrapDocumensoEnvelope(doc);
  const allRecipients = await fetchAllDocumensoRecipientPages(documentId, envelope);
  return {
    id: String(envelope?.id || doc?.id || documentId),
    status: mapDocumensoStatus(envelope?.status || doc?.status),
    recipients: allRecipients.map((r: any) => ({
      id: r.id,
      token: r.token,
      name: r.name || "",
      email: r.email || "",
      role: r.role,
      status: r.signingStatus || r.status || "pending",
      signedAt: r.signedAt || r.signed_at,
      signingUrl:
        r.signingUrl ??
        (r.token
          ? `${getDocumensoBaseUrlInfo().publicBaseUrl}/sign/${r.token}`
          : undefined),
    })),
    envelopeItems: envelope?.envelopeItems || doc?.envelopeItems || [],
    rawResponse: doc,
  };
}

export async function downloadCompletedDocumensoPdf(documentId: string): Promise<Buffer | null> {
  const doc = await getDocumensoDocument(documentId);
  if (doc.status !== "completed") return null;
  const itemId = doc.envelopeItems?.[0]?.id;
  const endpoint = itemId ? `/envelope/item/${encodeURIComponent(String(itemId))}/download` : `/document/${encodeURIComponent(documentId)}/download`;
  const res = await fetch(`${getBaseUrl()}${endpoint}`, {
    method: "GET",
    headers: { Authorization: getApiKey(), Accept: "application/pdf" },
  });
  if (!res.ok) {
    if (res.status === 404 || res.status === 400) return null;
    throw new Error(`Documenso PDF download failed with ${res.status}: ${await res.text()}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function downloadDocumensoAuditTrail(documentId: string): Promise<any> {
  return apiJson<any>("GET", `/envelope/${encodeURIComponent(documentId)}/audit-log`);
}

export async function voidDocumensoDocument(documentId: string): Promise<void> {
  await apiJson("POST", "/envelope/delete", { envelopeId: documentId });
}

export const DOCUMENSO_RESEND_REQUEST_CONTRACT = {
  method: "POST",
  endpoint: "/envelope/redistribute",
  bodyShape: "{ envelopeId: documentId }",
  includesRecipientIdentifiers: false,
} as const;

export async function resendDocumensoDocument(documentId: string): Promise<DocumensoDocumentResult> {
  const res = await apiJson<any>(DOCUMENSO_RESEND_REQUEST_CONTRACT.method, DOCUMENSO_RESEND_REQUEST_CONTRACT.endpoint, { envelopeId: documentId });
  const envelope = unwrapDocumensoEnvelope(res);
  return {
    documentId,
    status: mapDocumensoStatus(envelope?.status || res?.status || "PENDING"),
    signingLinks: (envelope?.recipients || []).map((r: any) => ({
      id: r.id != null ? String(r.id) : null,
      name: r.name || "",
      email: r.email || "",
      role: r.role ?? null,
      signingUrl:
        r.signingUrl ??
        (r.token
          ? `${getDocumensoBaseUrlInfo().publicBaseUrl}/sign/${r.token}`
          : undefined),
      token: r.token || null,
      status: r.signingStatus || r.status,
    })),
    auditUrl: `${getBaseUrl()}/envelope/${documentId}/audit-log`,
    rawResponse: res,
  };
}

export async function sendDocumentForSignature(options: CreateDocumensoDocumentOptions): Promise<DocumensoDocumentResult> {
  return createDocumensoDocument(options);
}

export async function getDocumentStatus(documentId: string) {
  return getDocumensoDocument(documentId);
}

export async function downloadCompletedDocument(documentId: string) {
  return downloadCompletedDocumensoPdf(documentId);
}

export async function voidDocument(documentId: string) {
  return voidDocumensoDocument(documentId);
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string, secret: string): boolean {
  if (!secret) return false;
  if (!signature) return false;
  try {
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(rawBody);
    const expectedHex = hmac.digest("hex");
    const normalized = signature.replace(/^sha256=/, "");
    const expected = Buffer.from(expectedHex);
    const actual = Buffer.from(normalized);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function verifyWebhookSecret(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): boolean {
  const secret = (process.env.DOCUMENSO_WEBHOOK_SECRET || process.env.MYPAYLINK_DOCUMENSO_WEBHOOK_SECRET || "").trim();
  if (!secret) return false;
  const headerSecret = headers["x-documenso-secret"] || headers["x-webhook-secret"];
  const signature = headers["x-documenso-signature"] || headers["documenso-signature"];
  const headerValue = Array.isArray(headerSecret) ? headerSecret[0] : headerSecret;
  if (headerValue) {
    const expected = Buffer.from(secret);
    const actual = Buffer.from(headerValue);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
  const sigValue = Array.isArray(signature) ? signature[0] : signature;
  return verifyWebhookSignature(rawBody, sigValue || "", secret);
}

export function logDocumensoConfig(): void {
  console.log("[Documenso] Configuration check:");
  const config = validateDocumensoConfig();
  console.log(`  API Key:        ${config.apiKeyConfigured ? "configured" : "MISSING — e-signature disabled"}`);
  console.log(`  Webhook Secret: ${config.webhookSecretConfigured ? "configured" : "MISSING — webhooks rejected"}`);
  console.log(`  Base URL:       ${getBaseUrl()}`);
}
