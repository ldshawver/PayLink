export interface ESignSigner {
  name: string;
  email: string;
  routingOrder?: number;
}

export interface CompanyESignConfig {
  docusign?: {
    accountId?: string;
    baseUrl?: string;
    accessToken?: string;
    hmacKey?: string;
    integrationKey?: string;
  };
  acrobat_sign?: {
    baseUrl?: string;
    accessToken?: string;
    clientId?: string;
    clientSecret?: string;
    webhookSecret?: string;
  };
}

export interface CreatePackageOptions {
  companyId: string;
  documentUrl: string;
  documentName: string;
  subject: string;
  message?: string;
  signers: ESignSigner[];
  returnUrl?: string;
}

export interface CreatePackageResult {
  providerEnvelopeId: string;
  status: string;
}

export interface EmbeddedSigningUrlOptions {
  providerEnvelopeId: string;
  signerEmail: string;
  signerName: string;
  returnUrl: string;
}

export interface EmbeddedSigningUrlResult {
  url: string;
  expiresAt?: Date;
}

export interface DownloadPdfResult {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

export interface WebhookVerificationResult {
  valid: boolean;
  eventType?: string;
  envelopeId?: string;
  signerEmail?: string;
  signerStatus?: string;
  envelopeStatus?: string;
  rawPayload?: string;
}

export interface ESignProviderAdapter {
  readonly providerName: string;

  createPackage(options: CreatePackageOptions, companyConfig?: CompanyESignConfig): Promise<CreatePackageResult>;

  getEmbeddedSigningUrl(options: EmbeddedSigningUrlOptions, companyConfig?: CompanyESignConfig): Promise<EmbeddedSigningUrlResult>;

  downloadFinalPdf(providerEnvelopeId: string, companyConfig?: CompanyESignConfig): Promise<DownloadPdfResult>;

  extractEnvelopeIdFromPayload(body: string | Buffer): string | undefined;

  verifyWebhook(headers: Record<string, string | string[] | undefined>, body: string | Buffer, companyConfig?: CompanyESignConfig): Promise<WebhookVerificationResult>;
}
