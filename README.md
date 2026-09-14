# Plaud → n8n → Google Calendar & Tasks (private NAS bridge)

Turn **new, already-transcribed** Plaud notes into proposed Google Calendar events and Google Tasks, while keeping the collector on a private NAS.

This is a self-hosted automation for personal use. It is intentionally **safe by default**: the bridge starts disabled, the first run only establishes a baseline (old recordings are ignored), and the n8n workflow should save a proposal before it creates anything.

> [!WARNING]
> A Plaud transcript is personal data. This design does not upload audio or ask a second service to transcribe it, but it does send the transcript to n8n and—if enabled—to the AI provider selected in n8n for intent extraction. Review that provider's data policy before enabling the workflow.

## What it does

```text
Plaud (its own transcript) → private bridge on NAS → n8n → review/validation → Google Calendar or Google Tasks
```

- Polls Plaud every ten minutes and ignores notes with no transcript.
- Creates a baseline on the first run, so it cannot retroactively create appointments from old recordings.
- Delivers each recording with a stable `plaud:<recording-id>` idempotency key.
- Requires an authenticated acknowledgement from n8n before marking a recording delivered.
- Keeps tokens, OAuth sessions, proposals and transcripts in private NAS paths that Git ignores.

## Before you start

You need a NAS (Synology Container Manager works), Docker, a private n8n instance and your own Plaud, Google and AI-provider accounts. You also need an OAuth client for your own Google account and must enable the Calendar and Tasks APIs in **your** Google Cloud project.

Use only the official Plaud tooling to authenticate and retrieve your own data. Do not reuse browser cookies, copy another person's session, or publish any OAuth callback URL, token or credential export.

Google uses OAuth 2.0; access tokens are short-lived and refresh tokens must be kept in secure long-term storage. Request only the scopes required for the automation. The Tasks write scope is `https://www.googleapis.com/auth/tasks`; Calendar also has a scoped OAuth permission model. See the official [Google OAuth guide](https://developers.google.com/identity/protocols/oauth2), [Google Tasks scopes](https://developers.google.com/workspace/tasks/auth), and [Calendar API setup](https://developers.google.com/workspace/calendar/api/quickstart/python).

## Installation

1. Copy this repository to a private directory on the NAS, for example `/volume1/docker/plaud-bridge`. Do **not** make that NAS directory public or synchronise it to a public cloud folder.
2. Install the official Plaud CLI inside the private runtime path expected by the bridge:

   ```sh
   npm install --prefix /volume1/docker/plaud-bridge/runtime @plaud-ai/cli
   ```

   Authenticate it using Plaud's official CLI instructions. The resulting `auth/` directory must remain on the NAS and is intentionally ignored by Git.
3. Copy `config.example.json` to `config.json`. Generate a unique random token locally, set the n8n webhook URL for your internal Docker network, and leave `enabled` as `false`.
4. Create a local `.env` next to `compose.yaml` with your private NAS path, image, user/group IDs and time zone. Do not commit it.
5. Build/select an image with Node.js 20+ and start the bridge with `docker compose up -d`.
6. Configure the n8n workflow following [WORKFLOW.md](WORKFLOW.md). Create all credentials in n8n manually; never import a credential file from someone else.
7. Run the bridge once with `enabled: false` to check `/health`. Then enable it **without a webhook URL** for one cycle if you want to create the historical baseline before connecting n8n.
8. Send one new, harmless test note. Confirm it is stored as a proposal and that no unwanted event/task appears. Only then enable the Calendar and Tasks creation nodes.

## Privacy and security checklist

Before any public Git push, run the checklist in [SECURITY.md](SECURITY.md). At minimum, keep these out of Git:

- `config.json`, `.env*`, `auth/` and `state/`;
- Plaud sessions/tokens; Google client secrets, refresh tokens and n8n credential exports;
- IP addresses, host names, user names, ports, Docker network names and absolute NAS paths;
- real recording IDs, transcript excerpts, task names, calendar IDs, screenshots and n8n execution exports.

The n8n workflow should be set to avoid storing successful execution data. Treat failed execution data as sensitive too: it can contain the full transcript and API error payloads.

## Important design limits

- This is not a general-purpose voice assistant. It only considers explicit requests in an existing Plaud transcript.
- Ambiguous items should be marked **review required**, never silently placed on a calendar.
- An event requires a date and a time. A task may have no date/time.
- Calendar/task writes are a separate action after proposal persistence. Start in review-only mode.
- Stable recording IDs prevent ordinary retry duplication, but you should also configure the n8n deduplication step described in the workflow guide.

## Testing

The unit tests do not contact Plaud, Google, n8n or any external service:

```sh
npm test
```

## Support this project

If this guide helped you and you decide to buy a Plaud device, you may use this creator/affiliate link. Purchases made through it may support the maintainer at no extra cost to you.

- [Plaud tracking link](https://bit.ly/4fDrqJj)
- Creator code: `JorgeRui`
- Discount: **10% off**
- Available markets: United States, United Kingdom, and Germany

For Plaud-related MakerWorld projects, visit the [Plaud collection on MakerWorld](https://makerworld.com/collections/33911427). More work is available on the [JorgeRui MakerWorld profile](https://makerworld.com/en/@JorgeRui).

## Reporting a security issue

Please do not open a public issue with a token, transcript, log or NAS address. See [SECURITY.md](SECURITY.md) for a safe reporting template.

## License

MIT. This repository contains integration code, not the Plaud CLI, n8n, Google APIs or OpenAI software. Their terms apply separately.
