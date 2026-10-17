# Antigravity usage

Shows Antigravity CLI (`agy`) quotas in Paseo's **Settings → Usage** page. The native card includes Gemini and Claude & GPT pools, each with 5-hour and weekly windows, usage percentages, reset countdowns, a subscription badge when available, and the signed-in account email.

## Setup

Requires Paseo 0.11.0 or later, a locally installed `agy`, and an existing Antigravity login saved under the user running the Paseo daemon. Windows uses Credential Manager, macOS uses Keychain, and Linux requires `secret-tool` and an accessible, unlocked Secret Service session. Windows has been verified with a real login and quota responses. macOS and Linux await real-host verification.

## Credentials and quota data

The plugin reads the specific `gemini` / `antigravity` OS credential item and sends its access token to Google Code Assist at `cloudcode-pa.googleapis.com` over HTTPS to retrieve quota and plan information. Account email comes from saved login metadata, including locally decoded ID-token claims. Tokens stay on the daemon side and are excluded from saved account inputs, reports, and logs.

Login renewal is managed by `agy`. When credentials expire or are rejected, Paseo displays its native diagnostic and directs you to renew the CLI login. The plugin reads the credential store without modifying it.

On free plans, 5-hour windows may remain full; weekly quotas show consumption. Omitted or invalid readings appear as unknown. Discovery is global and does not associate the daemon user's login with individual agent sessions.
