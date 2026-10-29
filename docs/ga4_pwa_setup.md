# WaveLead PWA — GA4 setup & reporting guide

Property: existing WaveLead GA4 (`G-MYGZLGH4SR`, loaded only after analytics consent by
`components/analytics/GoogleAnalytics.tsx`). No second GA4 instance exists. All events go through
`trackGa4Event` (consent gate, parameter allowlist, PII guard, sanitised `page_location`).

## Events
| Event | When | Confirmed install? |
|---|---|---|
| `pwa_install_cta_viewed` | Install sheet shown (auto or manual), once per opening | No |
| `pwa_install_cta_clicked` | "Install WaveLead" tapped, once per opening | No |
| `pwa_ios_instructions_viewed` | iOS Add-to-Home-Screen steps displayed (Safari, Chrome, Edge, Firefox, "open in Safari") | No |
| `pwa_install_prompt_accepted` | Chromium native prompt → user accepted | Intent (browser) |
| `pwa_install_prompt_dismissed` | Chromium native prompt → user dismissed | No |
| `pwa_app_installed` | Browser `appinstalled` event (Chromium only), once per page | **Yes — Android/Chromium only** |
| `pwa_standalone_launched` | App opened in standalone mode, once per session (sent only after consent) | Usage, not install |

iOS has no install-confirmation signal; none is invented. iOS adoption = `pwa_standalone_launched`
with `pwa_platform = ios`.

## Parameters → register as EVENT-scoped custom dimensions
GA4 Admin → Data display → Custom definitions → Create custom dimension (scope: Event):

| Dimension name | Event parameter | Values |
|---|---|---|
| PWA Platform | `pwa_platform` | android, ios, desktop, other |
| PWA Browser | `pwa_browser` | chrome, safari, edge, firefox, samsung_internet, other (omitted on `pwa_standalone_launched`) |
| PWA Entry Point | `pwa_entry_point` | auto_prompt, mobile_menu, footer |
| PWA Trigger | `pwa_trigger` | time_engagement, second_page, manual |
| PWA Display Mode | `pwa_display_mode` | browser, standalone |
| PWA Install Method | `pwa_install_method` | native_prompt, manual_a2hs |

Parameters are omitted when not applicable (e.g. no entry point on `pwa_app_installed`).
Dimensions only populate for data received AFTER they are registered (no backfill).

Optional key events (Admin → Events → mark as key event): `pwa_app_installed`, `pwa_standalone_launched`.

## Explorations (Explore → Free form / Funnel)
1. **Suggestion impressions:** `pwa_install_cta_viewed` count by PWA Entry Point × PWA Trigger.
2. **CTA click-through rate:** funnel `pwa_install_cta_viewed` → `pwa_install_cta_clicked`, breakdown PWA Platform.
3. **Android confirmed installs:** `pwa_app_installed` (filter PWA Platform = android), breakdown PWA Browser.
   Native prompt acceptance rate: `pwa_install_prompt_accepted` / (accepted + dismissed).
4. **iOS instruction engagement:** `pwa_ios_instructions_viewed` by PWA Browser and PWA Entry Point.
5. **Standalone sessions:** `pwa_standalone_launched` by PWA Platform (Android vs iOS separately).
6. **Returning PWA users:** segment "users with `pwa_standalone_launched`" → New vs Returning / user count by week.
7. **Downstream conversion:** apply segment (6) to existing events — discovery: `channel_profile_viewed`,
   `search_used`, `category_viewed`; registration: `sign_up`, `channel_submitted`; sponsorship:
   `sponsorship_request_sent`, `booking_created`, `campaign_booking_started`; paid: `brand_pro_checkout_started`,
   `founding_lifetime_checkout_started`, `fast_verification_checkout_started`.

**Never sum Android `pwa_app_installed` with iOS `pwa_standalone_launched` as "verified installs".**
Report: "Android confirmed installs" and "iOS standalone users (inferred)" as separate metrics.

## Validation (DebugView)
DebugView needs GA4 property access. Open https://tagassistant.google.com → connect wavelead.org
(this enables debug mode without code) → accept analytics cookies → trigger events → GA4 Admin →
DebugView. Events appear without consent only if consent is granted; rejecting cookies sends nothing.

## Note on preview traffic
The preview environment loads the same measurement ID once a tester accepts analytics cookies.
Use "Reject Non-Essential" in preview, or filter by hostname `wavelead.org` in reports.
