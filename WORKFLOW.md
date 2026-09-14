# n8n workflow: review first, then write

This guide deliberately uses the n8n interface to attach credentials. A public workflow JSON that includes credential IDs, callback URLs or encrypted credential blobs is not portable and may expose information about its author.

## Importable template

Import [n8n-workflow.template.json](n8n-workflow.template.json) into n8n. It contains the bridge intake, validation, AI interpretation, proposal persistence, and optional Google Calendar/Tasks branches — but **no credentials**. Google writes are disabled by a safety switch in the template. Complete the steps below before enabling it.

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
