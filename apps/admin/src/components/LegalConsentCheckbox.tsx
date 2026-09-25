import { MARKETING_PRIVACY_URL, MARKETING_TERMS_URL } from "../lib/links";

/**
 * Phase 77 — the one required-consent checkbox shared by every self-serve account-creation form
 * (RegisterPage.tsx, OwnerSignupWizardPage.tsx, AgencySignupWizardPage.tsx). Never preselected —
 * each caller owns its own `checked`/`onChange` state so the submit button can stay disabled until
 * it's checked, which is what actually makes acceptance required (this component itself has no
 * opinion on that; it just renders the control and the real, clickable links).
 */
export function LegalConsentCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        required
        className="mt-0.5"
      />
      <span>
        I agree to the{" "}
        <a href={MARKETING_TERMS_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
          Terms of Service
        </a>{" "}
        and{" "}
        <a href={MARKETING_PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
          Privacy Policy
        </a>
        .
      </span>
    </label>
  );
}
