import { useTrial } from "@/hooks/use-trial";
import { AlertTriangle, Clock, Sparkles } from "lucide-react";

export function TrialBanner() {
  const { isTrial, isTrialExpired, isDemo, daysRemaining, subscriptionStatus } = useTrial();

  if (isDemo) {
    return (
      <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-4 py-2.5 flex items-center justify-between text-sm" data-testid="banner-demo">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          <span className="font-medium">Demo Mode</span>
          <span className="opacity-80">— Exploring with sample data. Changes won't be saved.</span>
        </div>
        <a
          href="https://mypaylink.app/signup"
          className="bg-white/20 hover:bg-white/30 text-white px-4 py-1 rounded-md font-medium transition-colors"
          data-testid="link-demo-start-trial"
        >
          Start Free Trial →
        </a>
      </div>
    );
  }

  if (isTrialExpired || subscriptionStatus === "trial_expired") {
    return (
      <div className="bg-gradient-to-r from-red-600 to-orange-600 text-white px-4 py-2.5 flex items-center justify-between text-sm" data-testid="banner-trial-expired">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          <span className="font-medium">Trial Expired</span>
          <span className="opacity-80">— Upgrade to continue using PayLink. Your data is safe.</span>
        </div>
        <button
          className="bg-white/20 hover:bg-white/30 text-white px-4 py-1 rounded-md font-medium transition-colors"
          data-testid="button-upgrade-now"
          onClick={() => window.dispatchEvent(new CustomEvent("open-upgrade-modal"))}
        >
          Upgrade Now →
        </button>
      </div>
    );
  }

  if (isTrial) {
    const urgency = daysRemaining <= 5 ? "from-amber-600 to-orange-600" : "from-teal-600 to-blue-600";
    return (
      <div className={`bg-gradient-to-r ${urgency} text-white px-4 py-2.5 flex items-center justify-between text-sm`} data-testid="banner-trial-active">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          <span className="font-medium">{daysRemaining} days left in trial</span>
          <span className="opacity-80">— Full access to all features</span>
        </div>
        <a
          href="https://mypaylink.app/pricing"
          className="bg-white/20 hover:bg-white/30 text-white px-4 py-1 rounded-md font-medium transition-colors"
          target="_blank"
          rel="noopener"
          data-testid="link-trial-see-pricing"
        >
          See Pricing →
        </a>
      </div>
    );
  }

  return null;
}
