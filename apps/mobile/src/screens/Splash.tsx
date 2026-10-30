/** The splash screen: the real Gonq logo asset (assets/gonq-logo-OUTLINE.svg, unmodified and uncoloured), centred; no tagline, no wordmark. */
import logo from '@repo-assets/gonq-logo-OUTLINE.svg';

export function Splash() {
  return (
    <div className="m-splash">
      <img src={logo} alt="Gonq logo" />
    </div>
  );
}
