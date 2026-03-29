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

interface DocuSignRecipient {
  email?: string;
  status?: string;
  statusChangedDateTime?: string;
}

interface DocuSignWebhookPayload {
  event?: string;
  envelopeId?: string;
  status?: string;
  data?: {
    envelopeId?: string;
    envelopeSummary?: {
      status?: string;
      recipients?: {
        signers?: DocuSignRecipient[];
      };
    };
  };
}

function getConfig(companyConfig?: CompanyESignConfig) {
  const cc = companyConfig?.docusign;
  return {
    accountId: cc?.accountId || process.env.DOCUSIGN_ACCOUNT_ID || "",
    baseUrl: cc?.baseUrl || process.env.DOCUSIGN_BASE_URL || "https://demo.docusign.net/restapi",
    accessToken: cc?.accessToken || process.env.DOCUSIGN_ACCESS_TOKEN || "",
    hmacKey: cc?.hmacKey || process.env.DOCUSIGN_HMAC_KEY || "",
    integrationKey: cc?.integrationKey || process.env.DOCUSIGN_INTEGRATION_KEY || "",
  };
}

async function docusignFetch(path: string, options: RequestInit = {}, companyConfig?: CompanyESignConfig): Promise<unknown> {
  const config = getConfig(companyConfig);
  const url = `${config.baseUrl}/v2.1/accounts/${config.accountId}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.accessToken}`,
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DocuSign API error ${response.status}: ${errorText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response;
}

export class DocuSignAdapter implements ESignProviderAdapter {
  readonly providerName = "docusign";

  async createPackage(options: CreatePackageOptions, companyConfig?: CompanyESignConfig): Promise<CreatePackageResult> {
    const recipients = {
      signers: options.signers.map((signer, index) => ({
        email: signer.email,
        name: signer.name,
        recipientId: String(index + 1),
        routingOrder: String(signer.routingOrder || index + 1),
        clientUserId: signer.email,
        tabs: {
          signHereTabs: [
            {
              documentId: "1",
              pageNumber: "1",
              xPosition: "200",
              yPosition: "600",
            },
          ],
        },
      })),
    };

    let documentBase64 = "";
    const fs = await import("fs");
    const path = await import("path");
    if (options.documentUrl.startsWith("/uploads/") || options.documentUrl.startsWith("uploads/")) {
      const filePath = options.documentUrl.startsWith("/")
        ? path.join(process.cwd(), options.documentUrl)
        : path.join(process.cwd(), options.documentUrl);
      const fileBuffer = fs.readFileSync(filePath);
      documentBase64 = fileBuffer.toString("base64");
    } else if (options.documentUrl.startsWith("http")) {
      const response = await fetch(options.documentUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch document from ${options.documentUrl}: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      documentBase64 = Buffer.from(arrayBuffer).toString("base64");
    } else {
      const filePath = path.join(process.cwd(), options.documentUrl);
      if (fs.existsSync(filePath)) {
        const fileBuffer = fs.readFileSync(filePath);
        documentBase64 = fileBuffer.toString("base64");
      } else {
        throw new Error(`Document not found at path: ${options.documentUrl}`);
      }
    }

    const fileExtension = options.documentName.split(".").pop() || "pdf";

    const envelopeDefinition = {
      emailSubject: options.subject,
      emailBlurb: options.message || "",
      documents: [
        {
          documentId: "1",
          name: options.documentName,
          fileExtension,
          documentBase64,
        },
      ],
      recipients,
      status: "sent",
    };

    const result = await docusignFetch("/envelopes", {
      method: "POST",
      body: JSON.stringify(envelopeDefinition),
    }, companyConfig) as { envelopeId: string; status?: string };

    return {
      providerEnvelopeId: result.envelopeId,
      status: result.status || "sent",
    };
  }

  async getEmbeddedSigningUrl(options: EmbeddedSigningUrlOptions, companyConfig?: CompanyESignConfig): Promise<EmbeddedSigningUrlResult> {
    const recipientViewRequest = {
      returnUrl: options.returnUrl,
      authenticationMethod: "none",
      email: options.signerEmail,
      userName: options.signerName,
      clientUserId: options.signerEmail,
    };

    const result = await docusignFetch(
      `/envelopes/${options.providerEnvelopeId}/views/recipient`,
      {
        method: "POST",
        body: JSON.stringify(recipientViewRequest),
      },
      companyConfig
    ) as { url: string };

    return {
      url: result.url,
    };
  }

  async downloadFinalPdf(providerEnvelopeId: string, companyConfig?: CompanyESignConfig): Promise<DownloadPdfResult> {
    const config = getConfig(companyConfig);
    const url = `${config.baseUrl}/v2.1/accounts/${config.accountId}/envelopes/${providerEnvelopeId}/documents/combined`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        Accept: "application/pdf",
      },
    });

    if (!response.ok) {
      throw new Error(`DocuSign download error ${response.status}: ${await response.text()}`);
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
      const payload = JSON.parse(bodyStr) as DocuSignWebhookPayload;
      return payload.data?.envelopeId || payload.envelopeId || undefined;
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
    const hmacKey = config.hmacKey;

    if (!hmacKey) {
      return { valid: false };
    }

    {
      const signature = headers["x-docusign-signature-1"];
      if (!signature) {
        return { valid: false };
      }

      const bodyStr = typeof body === "string" ? body : body.toString("utf-8");
      const computedHmac = crypto
        .createHmac("sha256", hmacKey)
        .update(bodyStr)
        .digest("base64");

      const sigStr = Array.isArray(signature) ? signature[0] : signature;
      const computedBuf = Buffer.from(computedHmac);
      const sigBuf = Buffer.from(sigStr);
      if (computedBuf.length !== sigBuf.length || !crypto.timingSafeEqual(computedBuf, sigBuf)) {
        return { valid: false };
      }
    }

    const bodyStr = typeof body === "string" ? body : body.toString("utf-8");
    let payload: DocuSignWebhookPayload;
    try {
      payload = JSON.parse(bodyStr) as DocuSignWebhookPayload;
    } catch {
      return { valid: false };
    }

    const event = payload.event || "";
    const envelopeId = payload.data?.envelopeId || payload.envelopeId || "";
    const envelopeStatus = payload.data?.envelopeSummary?.status || payload.status || "";

    let signerEmail: string | undefined;
    let signerStatus: string | undefined;
    const recipients: DocuSignRecipient[] = payload.data?.envelopeSummary?.recipients?.signers || [];
    if (recipients.length > 0) {
      const lastUpdated = recipients.reduce((a: DocuSignRecipient, b: DocuSignRecipient) =>
        new Date(b.statusChangedDateTime || 0) > new Date(a.statusChangedDateTime || 0) ? b : a
      );
      signerEmail = lastUpdated.email;
      signerStatus = lastUpdated.status;
    }

    return {
      valid: true,
      eventType: event,
      envelopeId,
      signerEmail,
      signerStatus,
      envelopeStatus,
      rawPayload: bodyStr,
    };
  }
}
