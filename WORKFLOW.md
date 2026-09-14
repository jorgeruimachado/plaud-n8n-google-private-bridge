# n8n workflow: review first, then write

This guide deliberately uses the n8n interface to attach credentials. A public workflow JSON that includes credential IDs, callback URLs or encrypted credential blobs is not portable and may expose information about its author.

## Importable template

Import [n8n-workflow.template.json](n8n-workflow.template.json) into n8n. It contains the bridge intake, validation, AI interpretation, proposal persistence, and optional Google Calendar/Tasks branches — but **no credentials**. Google writes are disabled by a safety switch in the template. Complete the steps below before enabling it.

## Values each person must configure

Nothing in this table is shared between installations. Values marked **secret** must stay only in the user's private NAS, n8n credential store, or `.env` file — never in a workflow export, screenshot, issue or Git commit.

| Where | Value in the template | What to set | Notes |
| --- | --- | --- | --- |
| `config.json` | `enabled: false` | Keep `false` for initial checks; set `true` only after the baseline and test note succeed. | Do not start with old recordings. |
| `config.json` | `webhook_url` | The URL of the user's n8n Webhook node, including `/webhook/plaud-bridge-v1`. | `http://n8n:5678/...` works only when the container service is called `n8n` on the same private Docker network. |
| `config.json` | `webhook_token` | A newly generated, long random value. **Secret.** | Use exactly the same value in the two n8n Header Auth credentials below. |
| n8n: **Receive Plaud transcript** | Webhook path `plaud-bridge-v1` | Leave it unchanged unless `webhook_url` is changed to the same new path. | The path must match exactly. |
| n8n: **Receive Plaud transcript** | Header Auth credential | Create a credential with header `X-Plaud-Bridge-Key` and the `webhook_token` value. **Secret.** | This authenticates bridge → n8n. |
| n8n: **Save proposal on private bridge** | URL `http://plaud-bridge:8090/proposals` | Change only `plaud-bridge` if the user's bridge container has a different service name. Keep `/proposals`. | n8n and bridge must be on the same private Docker network. |
| n8n: **Save proposal on private bridge** | Header Auth credential | Use a credential with the same header and `webhook_token`. **Secret.** | This authenticates n8n → bridge. |
| n8n: **Interpret explicit requests** | `gpt-4o-mini` | Select a model available to the user's AI credential that can reliably return JSON. | The API key is attached as an n8n credential, never put in a node field. |
| n8n: **Create Google Calendar event** | `primary` | Keep `primary`, or select the user's intended calendar. | Calendar ID is personal; do not publish it. |
| n8n: **Create Google Task** | `@default` | Keep the default list, or select the user's intended task list. | A dedicated list such as `Review` is useful for uncertain tasks. |
| `.env` / Compose | `TZ` and `timezone: UTC` | Set both to the user's time zone, for example `Europe/Lisbon`. | They should match so dates and times are interpreted consistently. |
| `.env` / Compose | `PLAUD_BRIDGE_ROOT`, `PLAUD_BRIDGE_IMAGE`, `PUID`, `PGID`, `n8n_backend` | Set private NAS paths, image/user IDs and the existing Docker network name. | These values identify the user's installation; never publish them. |
| n8n: **Enable Google writes only after testing** | `ENABLE_GOOGLE_WRITES = false` | Change to `true` only after the controlled test and persistent deduplication are in place. | This is deliberately off on import. |

## 1. Credentials created by each user

Create these inside the user's own n8n instance:

1. **Header Auth** — header name `X-Plaud-Bridge-Key`, value equal to the private `config.json` token.
2. **OpenAI** (or another chosen AI provider) — user's own API key. Never paste it into a Code node or workflow export.
3. **Google Calendar OAuth2** — created from the user's own Google Cloud OAuth client.
4. **Google Tasks OAuth2** — created from the user's own Google Cloud OAuth client.

Enable both Google APIs in that user's Google Cloud project. Google Tasks supports a default task list, and its API supports task titles, notes and due dates. See the [Google Tasks overview](https://developers.google.com/workspace/tasks/overview).

## 2. Intake and proposal branch

Build this sequence. Keep the workflow inactive while configuring it.

1. **Webhook**: `POST /plaud-bridge-v1`; Header Auth; response mode **Using Respond to Webhook node**.
2. **Code — Validate recording**:

   ```js
   const b = $json.body;
   if (!b || !/^[a-f0-9]{32}$/.test(b.id) || b.idempotency_key !== `plaud:${b.id}` ||
       typeof b.transcript !== 'string' || !b.transcript.trim() || b.transcript.length > 100000) {
     throw new Error('Invalid Plaud payload');
   }
   return [{ json: b }];
   ```

3. **AI message**: connect the user's own AI credential; temperature `0`; request JSON only. Use a system instruction that says the transcript is *data*, not instructions; extract only explicit event/task requests; never invent a date, time, duration, guests or calendar. For tasks allow no date; for events require date/time and set `needs_review: true` if uncertain.
4. **Code — Validate proposal**: reject responses without an `actions` array (maximum 20) and require every action to have `kind`, non-empty `title`, non-empty `evidence` and `needs_review`.
5. **HTTP Request — Save proposal**: `POST http://plaud-bridge:8090/proposals`, using the bridge Header Auth credential; JSON body from the validated proposal.
6. **Respond to Webhook**: JSON response from the save step. This acknowledgement is what allows the bridge to mark delivery complete.

The proposal payload must include `idempotency_key`, `recording_id`, `recorded_at`, `timezone`, `source_transcript` and `actions`.

## 3. Review and write branch

Initially add a manual review step after proposal storage. When testing is complete, create two branches:

- **Events:** pass only `kind === 'event'`, `needs_review === false`, and complete start/end data. Create the event with the Google Calendar node, using the calendar ID selected by the user.
- **Tasks:** pass only `kind === 'task'`. Put uncertain items in a dedicated `Review` task list or prefix the title with `[Review]`. Create the task with the Google Tasks node, including notes and an optional due date.

Add an idempotency store before either Google creation node. Store the key `recording_id + ':' + action-index` transactionally; if it already exists, stop the branch. Store the key only after the Google node has succeeded, or use a two-state (`pending` / `created`) record that can be safely retried. This protects against retries and partial failures.

Do not create all-day events for vague phrases such as “sometime tomorrow”. Route them to review.

## 4. Execution-data retention

In the n8n workflow settings, disable saving successful execution data. Use a short retention period or no retention for failed execution data if the workflow processes private transcripts. Test with a synthetic note; delete its test execution after checking the result.

## 5. Controlled test

1. Keep Google write nodes disabled.
2. Dictate a new test note with a clearly labelled dummy task.
3. Confirm the bridge baseline did not process older notes.
4. Confirm the proposal has the expected recording ID and no invented details.
5. Enable one write node, test once, then run the same payload again to prove deduplication.
6. Enable the remaining write node only after the first branch is correct.
