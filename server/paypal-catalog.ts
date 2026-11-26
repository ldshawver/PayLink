/**
 * Idempotent PayPal product + $1 unit plan. Safe to run more than once.
 */
import { paypalRequest, readPaypalConfig, type PaypalDeps } from "./paypal-client";

const PRODUCT_NAME = "MyPayLink Starter";
const PLAN_NAME = "MyPayLink Starter monthly unit";

interface Product { id: string; name?: string }
interface Plan {
  id: string;
  name?: string;
  status?: string;
  billing_cycles?: Array<{ pricing_scheme?: { fixed_price?: { value?: string; currency_code?: string } } }>;
}

function isUnitPlan(plan: Plan): boolean {
  return (plan.billing_cycles || []).some((cycle) => {
    const price = cycle.pricing_scheme?.fixed_price;
    return price?.currency_code === "USD" && price.value === "1.00";
  });
}

export async function ensurePaypalCatalog(deps: PaypalDeps = {}): Promise<{ productId: string; planId: string; createdProduct: boolean; createdPlan: boolean }> {
  if (!readPaypalConfig() && !deps.config) throw new Error("PayPal is not configured");
  const listed = await paypalRequest<{ products?: Product[] }>("/v1/catalogs/products?page_size=20&total_required=false", {}, deps);
  let product = (listed.products || []).find((item) => item.name === PRODUCT_NAME);
  let createdProduct = false;
  if (!product) {
    product = await paypalRequest<Product>("/v1/catalogs/products", {
      method: "POST",
      body: { name: PRODUCT_NAME, type: "SERVICE", category: "SOFTWARE", description: "MyPayLink payroll and HR subscription" },
    }, deps);
    createdProduct = true;
  }
  const plans = await paypalRequest<{ plans?: Plan[] }>(`/v1/billing/plans?product_id=${encodeURIComponent(product.id)}&page_size=20`, {}, deps);
  let plan = (plans.plans || []).find((item) => item.status === "ACTIVE" && isUnitPlan(item));
  let createdPlan = false;
  if (!plan) {
    plan = await paypalRequest<Plan>("/v1/billing/plans", {
      method: "POST",
      body: {
        product_id: product.id,
        name: PLAN_NAME,
        description: "1 unit = $1 of the monthly bill: $29 base + $4 per active employee.",
        status: "ACTIVE",
        billing_cycles: [{
          frequency: { interval_unit: "MONTH", interval_count: 1 },
          tenure_type: "REGULAR",
          sequence: 1,
          pricing_scheme: { fixed_price: { value: "1.00", currency_code: "USD" } },
        }],
        payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 1 },
      },
    }, deps);
    createdPlan = true;
  }
  return { productId: product.id, planId: plan.id, createdProduct, createdPlan };
}
