import type { ESignProviderAdapter } from "./types";
import { DocuSignAdapter } from "./docusign";
import { AcrobatSignAdapter } from "./acrobat-sign";

export type { ESignProviderAdapter } from "./types";
export type {
  CreatePackageOptions,
  CreatePackageResult,
  EmbeddedSigningUrlOptions,
  EmbeddedSigningUrlResult,
  DownloadPdfResult,
  WebhookVerificationResult,
  ESignSigner,
  CompanyESignConfig,
} from "./types";

const adapters: Record<string, ESignProviderAdapter> = {
  docusign: new DocuSignAdapter(),
  acrobat_sign: new AcrobatSignAdapter(),
};

export function getESignAdapter(provider: string): ESignProviderAdapter {
  const adapter = adapters[provider];
  if (!adapter) {
    throw new Error(`Unknown e-signature provider: ${provider}. Supported: ${Object.keys(adapters).join(", ")}`);
  }
  return adapter;
}

export function getSupportedProviders(): string[] {
  return Object.keys(adapters);
}

export { DocuSignAdapter } from "./docusign";
export { AcrobatSignAdapter } from "./acrobat-sign";
