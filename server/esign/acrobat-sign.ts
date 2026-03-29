import crypto from "crypto";
import type {
  ESignProviderAdapter,
  CreatePackageOptions,
  CreatePackageResult,
  EmbeddedSigningUrlOptions,
  EmbeddedSigningUrlResult,
  DownloadPdfResult,
  WebhookVerificationResult,
  CompanyESignConfig,
} from "./types";

interface AcrobatSignMemberInfo {
  email?: string;
  status?: string;
}

interface AcrobatSignParticipantSet {
  memberInfos?: AcrobatSignMemberInfo[];
}

interface AcrobatSignWebhookPayload {
  event?: string;
  agreementId?: string;
  webhookNotificationApplicableUsers?: Array<{ event?: string }>;
  agreement?: {
    id?: string;
    status?: string;
    participantSetsInfo?: AcrobatSignParticipantSet[];
  };
}

interface AcrobatSignSigningUrl {
  email?: string;
  esignUrl?: string;
}

interface AcrobatSignSigningUrlSet {
  signingUrls?: AcrobatSignSigningUrl[];
}

interface AcrobatSignViewsResponse {
  url?: string;
  signingUrlSetInfos?: AcrobatSignSigningUrlSet[];
}

function getConfig(companyConfig?: CompanyESignConfig) {
  const cc = companyConfig?.acrobat_sign;
  return {
    baseUrl: cc?.baseUrl || process.env.ACROBAT_SIGN_BASE_URL || "https://api.na1.adobesign.com/api/rest/v6",
    accessToken: cc?.accessToken || process.env.ACROBAT_SIGN_ACCESS_TOKEN || "",
    clientId: cc?.clientId || process.env.ACROBAT_SIGN_CLIENT_ID || "",
    clientSecret: cc?.clientSecret || process.env.ACROBAT_SIGN_CLIENT_SECRET || "",
    webhookSecret: cc?.webhookSecret || process.env.ACROBAT_SIGN_WEBHOOK_SECRET || "",
  };
}

async function acrobatFetch(path: string, options: RequestInit = {}, companyConfig?: CompanyESignConfig): Promise<unknown> {
  const config = getConfig(companyConfig);
  const url = `${config.baseUrl}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.accessToken}`,
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Acrobat Sign API error ${response.status}: ${errorText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response;
}

export class AcrobatSignAdapter implements ESignProviderAdapter {
  readonly providerName = "acrobat_sign";

  async createPackage(options: CreatePackageOptions, companyConfig?: CompanyESignConfig): Promise<CreatePackageResult> {
    const fs = await import("fs");
    const pathMod = await import("path");

    let fileBuffer: Buffer;
    if (options.documentUrl.startsWith("http")) {
      const response = await fetch(options.documentUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch document from ${options.documentUrl}: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      fileBuffer = Buffer.from(arrayBuffer);
    } else {
      const filePath = options.documentUrl.startsWith("/")
        ? pathMod.join(process.cwd(), options.documentUrl)
        : pathMod.join(process.cwd(), options.documentUrl);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Document not found at path: ${options.documentUrl}`);
      }
      fileBuffer = fs.readFileSync(filePath);
    }

    const boundary = `----FormBoundary${Date.now()}`;
    const mimeType = options.documentName.endsWith(".pdf") ? "application/pdf" : "application/octet-stream";
    const formParts = [
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="File"; filename="${options.documentName}"\r\n`,
      `Content-Type: ${mimeType}\r\n\r\n`,
    ];
    const formHeader = Buffer.from(formParts.join(""));
    const formFooter = Buffer.from(`\r\n--${boundary}--\r\n`);
    const formBody = Buffer.concat([formHeader, fileBuffer, formFooter]);

    const config = getConfig(companyConfig);
    const transientDocResponse = await fetch(`${config.baseUrl}/transientDocuments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: formBody,
    });

    if (!transientDocResponse.ok) {
      throw new Error(`Acrobat Sign transient document upload failed: ${transientDocResponse.status}`);
    }

    const transientDocResult = await transientDocResponse.json() as { transientDocumentId: string };
    const transientDocumentId = transientDocResult.transientDocumentId;

    const participantSets = options.signers.map((signer, index) => ({
      memberInfos: [
        {
          email: signer.email,
          name: signer.name,
        },
      ],
      order: signer.routingOrder || index + 1,
      role: "SIGNER",
    }));

    const agreementInfo = {
      name: options.subject,
      message: options.message || "",
      fileInfos: [
        {
          transientDocumentId,
        },
      ],
      participantSetsInfo: participantSets,
      signatureType: "ESIGN",
      state: "IN_PROCESS",
    };

    const result = await acrobatFetch("/agreements", {
      method: "POST",
      body: JSON.stringify(agreementInfo),
    }, companyConfig) as { id: string };

    return {
      providerEnvelopeId: result.id,
      status: "sent",
    };
  }

  async getEmbeddedSigningUrl(options: EmbeddedSigningUrlOptions, companyConfig?: CompanyESignConfig): Promise<EmbeddedSigningUrlResult> {
    const result = await acrobatFetch(
      `/agreements/${options.providerEnvelopeId}/views`,
      {
        method: "POST",
        body: JSON.stringify({
          name: "DOCUMENT",
          commonViewConfiguration: {
            autoLoginUser: true,
            noChrome: false,
          },
        }),
      },
      companyConfig
    ) as AcrobatSignViewsResponse;

    const signingUrlViews: AcrobatSignSigningUrlSet[] = result.signingUrlSetInfos || [];
    let signingUrl = "";
    for (const urlSet of signingUrlViews) {
      const urlInfo = urlSet.signingUrls?.find(
        (u: AcrobatSignSigningUrl) => u.email === options.signerEmail
      );
      if (urlInfo) {
        signingUrl = urlInfo.esignUrl || "";
        break;
      }
    }

    if (!signingUrl && signingUrlViews.length > 0) {
      const firstSet = signingUrlViews[0];
      signingUrl = firstSet.signingUrls?.[0]?.esignUrl || result.url || "";
    }

    return {
      url: signingUrl,
    };
  }

  async downloadFinalPdf(providerEnvelopeId: string, companyConfig?: CompanyESignConfig): Promise<DownloadPdfResult> {
    const config = getConfig(companyConfig);
    const url = `${config.baseUrl}/agreements/${providerEnvelopeId}/combinedDocument`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        Accept: "application/pdf",
      },
    });

    if (!response.ok) {
      throw new Error(`Acrobat Sign download error ${response.status}: ${await response.text()}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      fileName: `signed_${providerEnvelopeId}.pdf`,
      mimeType: "application/pdf",
    };
  }

  extractEnvelopeIdFromPayload(body: string | Buffer): string | undefined {
    try {
      const bodyStr = typeof body === "string" ? body : body.toString("utf-8");
      const payload = JSON.parse(bodyStr) as AcrobatSignWebhookPayload;
      return payload.agreement?.id || payload.agreementId || undefined;
    } catch {
      return undefined;
    }
  }

  async verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    body: string | Buffer,
    companyConfig?: CompanyESignConfig
  ): Promise<WebhookVerificationResult> {
    const config = getConfig(companyConfig);

    if (!config.clientId) {
      return { valid: false };
    }

    const clientId = headers["x-adobesign-clientid"];
    if (!clientId) {
      return { valid: false };
    }
    const clientIdStr = Array.isArray(clientId) ? clientId[0] : clientId;
    if (clientIdStr !== config.clientId) {
      return { valid: false };
    }

    if (!config.webhookSecret) {
      return { valid: false };
    }

    const signature = headers["x-adobesign-signature"];
    if (!signature) {
      return { valid: false };
    }
    const bodyStr = typeof body === "string" ? body : body.toString("utf-8");
    const computedHmac = crypto
      .createHmac("sha256", config.webhookSecret)
      .update(bodyStr)
      .digest("base64");

    const sigStr = Array.isArray(signature) ? signature[0] : signature;
    const computedBuf = Buffer.from(computedHmac);
    const sigBuf = Buffer.from(sigStr);
    if (computedBuf.length !== sigBuf.length || !crypto.timingSafeEqual(computedBuf, sigBuf)) {
      return { valid: false };
    }

    let payload: AcrobatSignWebhookPayload;
    try {
      payload = JSON.parse(bodyStr) as AcrobatSignWebhookPayload;
    } catch {
      return { valid: false };
    }

    const event = payload.event || payload.webhookNotificationApplicableUsers?.[0]?.event || "";
    const agreementId = payload.agreement?.id || payload.agreementId || "";
    const agreementStatus = payload.agreement?.status || "";

    let signerEmail: string | undefined;
    let signerStatus: string | undefined;

    const participantSets: AcrobatSignParticipantSet[] = payload.agreement?.participantSetsInfo || [];
    for (const pSet of participantSets) {
      for (const member of pSet.memberInfos || []) {
        if (member.status === "COMPLETED" || member.status === "SIGNED") {
          signerEmail = member.email;
          signerStatus = member.status?.toLowerCase();
          break;
        }
      }
      if (signerEmail) break;
    }

    return {
      valid: true,
      eventType: event,
      envelopeId: agreementId,
      signerEmail,
      signerStatus,
      envelopeStatus: agreementStatus?.toLowerCase(),
      rawPayload: bodyStr,
    };
  }

  async registerWebhook(callbackUrl: string, companyConfig?: CompanyESignConfig): Promise<{ webhookId: string }> {
    const config = getConfig(companyConfig);
    const result = await acrobatFetch("/webhooks", {
      method: "POST",
      body: JSON.stringify({
        name: "PayLink E-Sign Webhook",
        scope: "ACCOUNT",
        state: "ACTIVE",
        webhookSubscriptionEvents: [
          "AGREEMENT_CREATED",
          "AGREEMENT_ACTION_COMPLETED",
          "AGREEMENT_ACTION_DELEGATED",
          "AGREEMENT_ACTION_REQUESTED",
          "AGREEMENT_ALL",
          "AGREEMENT_WORKFLOW_COMPLETED",
        ],
        webhookUrlInfo: {
          url: callbackUrl,
        },
        applicationName: "PayLink",
        applicationDisplayName: "PayLink HR",
        webhookConditionalParams: {
          webhookAgreementEvents: {
            includeDetailedInfo: true,
            includeDocumentsInfo: true,
            includeParticipantsInfo: true,
            includeSignedDocuments: false,
          },
        },
      }),
    }, companyConfig) as { id: string };

    return { webhookId: result.id };
  }

  handleVerificationOfIntent(
    headers: Record<string, string | string[] | undefined>,
    companyConfig?: CompanyESignConfig
  ): { clientId: string } | null {
    const clientId = headers["x-adobesign-clientid"];
    if (!clientId) return null;
    const config = getConfig(companyConfig);
    const clientIdStr = Array.isArray(clientId) ? clientId[0] : clientId;
    if (clientIdStr === config.clientId) {
      return { clientId: clientIdStr };
    }
    return null;
  }
}
