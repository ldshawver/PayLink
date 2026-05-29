/**
 * Documenso Integration Service
 *
 * Provides a reusable interface to the Documenso e-signature API.
 * Uses environment variables — never hardcoded secrets.
 *
 * Required env vars:
 *   MyPayLink_DOCUMENSO_API_KEY    — Documenso API key
 *   DOCUMENSO_WEBHOOK_SECRET       — HMAC-SHA256 secret for webhook verification
 *   DOCUMENSO_URL                  — Base URL (default: https://app.documenso.com)
 *
 * Note: Without a configured .p12 signing certificate Documenso can start but
 * document signing may fail. Set up a signing cert in your Documenso instance.
 */
import crypto from "crypto";

const DOCUMENSO_BASE_URL = process.env.DOCUMENSO_URL || "https://app.documenso.com";

function getApiKey(): string {
  const key = process.env.MyPayLink_DOCUMENSO_API_KEY;
  if (!key) throw new Error("Documenso not configured: MyPayLink_DOCUMENSO_API_KEY is missing");
  return key;
}

async function apiRequest<T = any>(method: string, endpoint: string, body?: any): Promise<T> {
  const key = getApiKey();
  const url = `${DOCUMENSO_BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let errText = "";
    try { errText = await res.text(); } catch { /* noop */ }
    throw new Error(`Documenso API ${method} ${endpoint} → ${res.status}: ${errText}`);
  }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DocumensoRecipient {
  name: string;
  email: string;
  role?: "SIGNER" | "VIEWER" | "APPROVER" | "CC";
  routingOrder?: number;
}

export interface SendDocumentOptions {
  title: string;
  pdfBuffer: Buffer;
  recipients: DocumensoRecipient[];
  subject?: string;
  message?: string;
  /** ISO date string — if omitted Documenso uses its default (30 days) */
  expiresAt?: string;
}

export interface DocumensoDocumentResult {
  documentId: string;
  status: string;
  recipients: { name: string; email: string; status: string }[];
  rawResponse: any;
}

// ─── Main API Functions ───────────────────────────────────────────────────────

/**
 * Create a document in Documenso, attach a PDF, add recipients, and send.
 * Returns the Documenso document ID for tracking.
 */
export async function sendDocumentForSignature(options: SendDocumentOptions): Promise<DocumensoDocumentResult> {
  const { title, pdfBuffer, recipients, subject, message, expiresAt } = options;

  if (!recipients.length) throw new Error("At least one recipient is required");

  const base64Pdf = pdfBuffer.toString("base64");

  // Documenso v1 document creation with embedded PDF data and recipients
  const payload: any = {
    title,
    data: {
      base64: base64Pdf,
      name: `${title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.pdf`,
    },
    recipients: recipients.map((r, i) => ({
      name: r.name,
      email: r.email,
      role: r.role || "SIGNER",
      routingOrder: r.routingOrder ?? i + 1,
    })),
    meta: {
      subject: subject || `Please sign: ${title}`,
      message: message || `You have been requested to sign "${title}". Please review and sign at your earliest convenience.`,
      ...(expiresAt ? { expiresAt } : {}),
    },
    sendDocument: true, // immediately send after creation
  };

  const created = await apiRequest<any>("POST", "/api/v1/documents", payload);
  const documentId = String(created?.id || created?.documentId || "");
  if (!documentId) throw new Error("Documenso returned no document ID: " + JSON.stringify(created));

  return {
    documentId,
    status: created?.status || "PENDING",
    recipients: (created?.recipients || []).map((r: any) => ({
      name: r.name,
      email: r.email,
      status: r.status || "PENDING",
    })),
    rawResponse: created,
  };
}

/**
 * Get the current status of a Documenso document.
 */
export async function getDocumentStatus(documentId: string): Promise<{
  id: string;
  status: string;
  recipients: { name: string; email: string; status: string; signedAt?: string }[];
}> {
  const doc = await apiRequest<any>("GET", `/api/v1/documents/${documentId}`);
  return {
    id: String(doc?.id || documentId),
    status: doc?.status || "UNKNOWN",
    recipients: (doc?.recipients || []).map((r: any) => ({
      name: r.name || "",
      email: r.email || "",
      status: r.status || "PENDING",
      signedAt: r.signedAt || r.signed_at,
    })),
  };
}

/**
 * Download the completed, signed PDF from Documenso.
 * Returns raw PDF bytes, or null if the document is not yet completed.
 */
export async function downloadCompletedDocument(documentId: string): Promise<Buffer | null> {
  const key = getApiKey();
  const url = `${DOCUMENSO_BASE_URL}/api/v1/documents/${documentId}/download`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}`, Accept: "application/pdf" },
  });
  if (!res.ok) {
    if (res.status === 404 || res.status === 400) return null;
    throw new Error(`Documenso download failed ${res.status}: ${await res.text()}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * Void / cancel a Documenso document.
 */
export async function voidDocument(documentId: string): Promise<void> {
  await apiRequest("DELETE", `/api/v1/documents/${documentId}`);
}

// ─── Webhook Verification ─────────────────────────────────────────────────────

/**
 * Verify a Documenso webhook HMAC-SHA256 signature.
 * Documenso sends the signature in the X-Documenso-Signature header.
 * Returns true if valid (or if no secret is configured — to allow dev mode).
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string,
  secret: string,
): boolean {
  if (!secret) {
    // No secret configured — accept all (warn only)
    console.warn("[Documenso] DOCUMENSO_WEBHOOK_SECRET not configured — skipping signature check");
    return true;
  }
  if (!signature) return false;
  try {
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(rawBody);
    const expected = hmac.digest("hex");
    const sigBuf = Buffer.from(signature.replace(/^sha256=/, ""));
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

// ─── Configuration Check (call at startup) ───────────────────────────────────

export function logDocumensoConfig(): void {
  const apiKey = process.env.MyPayLink_DOCUMENSO_API_KEY;
  const webhookSecret = process.env.DOCUMENSO_WEBHOOK_SECRET;
  const webhookUrl = process.env.DOCUMENSO_WEBHOOK_URL;
  const baseUrl = process.env.DOCUMENSO_URL || "https://app.documenso.com (default)";

  console.log("[Documenso] Configuration check:");
  console.log(`  API Key:        ${apiKey ? "configured" : "MISSING — e-signature disabled"}`);
  console.log(`  Webhook Secret: ${webhookSecret ? "configured" : "MISSING — webhook signature not verified"}`);
  console.log(`  Webhook URL:    ${webhookUrl || "not set"}`);
  console.log(`  Base URL:       ${baseUrl}`);

  if (!apiKey) {
    console.warn("[Documenso] ⚠  Without an API key, contract e-signatures will not work.");
  }
  if (!webhookSecret) {
    console.warn("[Documenso] ⚠  Without a webhook secret, incoming webhook events are unverified.");
  }
}
