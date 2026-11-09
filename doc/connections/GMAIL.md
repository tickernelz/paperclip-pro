# Gmail connection

Wardmote connects to Google's hosted Gmail MCP server at
`https://gmailmcp.googleapis.com/mcp/v1`. Gmail authorization is separate from
Google sign-in:

- Google sign-in identifies a user and requests only `openid email profile`.
- Gmail authorization lets that user's agents search and read mail and create
  drafts. It requests only `gmail.readonly` and `gmail.compose`.

Do not add Gmail scopes to a Google sign-in client. Gmail uses a customer-owned
Google OAuth web client: the instance stores the client ID and secret, runs the
authorization code flow against its own callback, and keeps the encrypted
access and refresh tokens in its vault.

> Google Workspace MCP is a Developer Preview. Enroll the required Workspace
> organization and test accounts in Google's Developer Preview Program before
> relying on the service.

## Deployment layout

Use a separate Google Cloud project and OAuth web client for each environment
you run (for example development and production). Each client's authorized
redirect URI is the instance's tool OAuth callback:

```text
https://<instance-host>/api/tools/oauth/callback
```

Register the exact origin the browser uses for that instance, including a
Tailscale HTTPS name when the instance is reached that way. Loopback HTTP
(`http://localhost:<port>`) is accepted for local development only.

Keeping projects separate prevents a development credential or consent-screen
change from affecting production and keeps restricted-scope Gmail verification
independent of Google sign-in.

## Google Cloud setup

### 1. Create the project

1. Open [Google Cloud project creation](https://console.cloud.google.com/projectcreate).
2. Create one project per environment.
3. Limit Owner and Editor access to the smallest operator group.
4. Add a monitored engineering or security contact.
5. Record the project id in a private runbook. Do not put a client secret in
   the runbook or repository.

### 2. Enable Gmail and Gmail MCP

In **APIs & Services → Library**, enable:

- Gmail API: `gmail.googleapis.com`
- Gmail MCP API: `gmailmcp.googleapis.com`

The equivalent command is:

```sh
gcloud services enable \
  gmail.googleapis.com \
  gmailmcp.googleapis.com \
  --project=PROJECT_ID
```

### 3. Configure branding

Open **Google Auth Platform → Branding** and set the app name, a monitored
support address, the homepage, privacy policy, terms of service, authorized
domain, and a developer contact. The privacy policy must state that the
instance stores Gmail credentials encrypted in its own vault.

### 4. Configure the audience

Open **Google Auth Platform → Audience**.

- Development: select **External**, keep the app in **Testing**, and add only
  developer test accounts.
- Production: select **Internal** for a single Workspace organization, or
  **External** and move to **In production** only after the required
  restricted-scope verification is complete.

Google limits an external testing app to 100 test users. For non-basic scopes,
testing grants and their offline refresh tokens can expire after seven days.
Treat that expiry as expected test behavior.

### 5. Add the exact scopes

Open **Google Auth Platform → Data Access → Add or remove scopes → Manually add
scopes** and add only:

```text
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.compose
```

Do not add `mail.google.com`, `gmail.modify`, `gmail.send`, Drive, Calendar, or
profile/sign-in scopes. Gmail read and compose are restricted scopes. Public
production use therefore requires Google's restricted-scope verification.

### 6. Create the OAuth client

Open **Google Auth Platform → Clients → Create Client**:

1. Select **Web application**.
2. Add exactly the instance callback above as the authorized redirect URI.
3. Leave **Authorized JavaScript origins** empty. This is a server-side flow.
4. Create the client.

Enter the client ID and secret in **Apps → Gmail → Use your own Google OAuth
app** during setup. The instance stores them through its vault. Never paste
either credential into an issue, document, chat, screenshot, committed `.env`,
build log, or browser-visible configuration.

## Connector request requirements

The Gmail authorization request uses:

- the Gmail OAuth client, not the Google sign-in client;
- the instance callback `/api/tools/oauth/callback`;
- `response_type=code`;
- the two exact Gmail scopes above;
- `access_type=offline`;
- `prompt=consent` for every connect and explicit reconnect;
- a random, short-lived, single-use state value; and
- PKCE S256.

After token exchange the granted scope set is compared with the two required
scopes. If either is missing, the personal connection grant stays inactive and
the user can retry deliberately. No access token, refresh token, authorization
code, or client secret may appear in a browser URL.

## Access defaults

Gmail uses the same credential ownership choice as the rest of the Apps setup:

- **Just me** stores the Gmail credential on the connecting user's grant.
- **Any human in the organization** stores it on the default organization grant
  so a deliberately shared mailbox or Workspace account can back
  organization-wide use.
- The disclosure states that Gmail access can search/read mail and create
  drafts. Sending mail is not enabled.
- A user grant does not automatically authorize an agent. The user must also
  install the connection for that agent, select an access profile, and grant
  standing delegation before autonomous use.
- Read, search, get, and list tools may be enabled after explicit profile
  review.
- Draft creation and label changes require **Ask first**.
- Trash, spam, destructive label changes, newly discovered tools, nested
  execution, and any future send tool remain blocked until separately reviewed.

## Verification checklist

1. Use an isolated Gmail test mailbox.
2. Connect from localhost and from the instance's HTTPS origin.
3. From the board Test panel, run `list_labels` and a bounded
   `search_threads` query.
4. Install the reviewed profile on one test agent and repeat one read-only call
   in a fresh agent run.
5. Create a draft through an Ask-first approval and verify no send action is
   exposed.
6. Force access-token expiry and verify refresh changes only the instance's
   encrypted secret version.
7. Revoke the grant and verify the next call fails closed.
8. Confirm sanitized logs, activity, API payloads, agent context, and browser
   history contain no credential or authorization code.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `redirect_uri_mismatch` | The client contains the exact instance callback, including scheme, host, port, path, and no extra slash. |
| Test user cannot consent | The account is listed under the project's Audience test users and is enrolled in Workspace Developer Preview. |
| Refresh fails after seven days | The external app is still in Testing. Reauthorize the test user; do not treat this as token-rotation failure. |
| One required capability is missing | Inspect the returned granted scope set. Keep the grant inactive if either exact required scope is absent. |
| Login starts asking for Gmail | The login and Gmail clients have been mixed; use a separate client for Gmail. |

## References

- [Configure Google Workspace MCP servers](https://developers.google.com/workspace/guides/configure-mcp-servers)
- [OAuth 2.0 for web server applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google OAuth 2.0 policies](https://developers.google.com/identity/protocols/oauth2/policies)
- [Choose Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Google Workspace API user data and developer policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
