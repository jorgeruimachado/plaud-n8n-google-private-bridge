# Security policy

## Never publish

Do not include any of the following in an issue, pull request, screenshot, log, workflow export or commit:

- API keys, OAuth client secrets, refresh/access tokens, cookies or credential exports;
- `config.json`, `.env`, `auth/`, `state/`, Docker volumes or n8n execution data;
- transcripts, recording IDs, task/event titles, calendar IDs or contact information;
- NAS model/host name, LAN/WAN address, SSH port/user/key name, internal URL, Docker network or absolute storage path.

`.gitignore` prevents common accidental additions, but it cannot protect a file that has already been staged or committed. Before every push, inspect both `git status` and the staged diff.

## If a secret was exposed

1. Revoke/rotate the affected key, token, password or OAuth client immediately.
2. Remove the secret from the current files **and Git history** before making the repository public.
3. Re-authorize the affected account where appropriate.
4. Treat copied logs and screenshots as exposed too.

## Private vulnerability report template

Use a private contact channel with the maintainer. Include only:

```text
Summary:
Affected version/commit:
Steps to reproduce (no real account data):
Impact:
Suggested mitigation (optional):
```

Never attach an actual credential or transcript as proof.
