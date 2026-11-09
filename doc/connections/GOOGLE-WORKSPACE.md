# Google Workspace connections

Paperclip presents Google Workspace as nine independent Apps entries, not as
one combined Google connection:

1. Gmail
2. Google Drive
3. Google Docs
4. Google Sheets
5. Google Slides
6. Google Calendar
7. Google Chat
8. Google People
9. Google Workspace Search

Each entry creates its own connection, consent grant, capability catalog,
policy, audit trail, and reconnect/revoke lifecycle. Connecting Drive does not
create a Docs or Sheets connection, and connecting Gmail does not enable
Workspace Search.

Google's hosted Workspace MCP servers are Developer Preview services. The app
cards remain independent even when several services use the same customer-owned
Google OAuth client.

## Temporary Connections page visibility hold

While Google OAuth verification is pending, the Connections landing page
(`ui/src/pages/apps/Browse.tsx`) hides all nine Google Workspace entries,
including their saved accounts. This is a display-only filter. App definitions,
direct setup and management routes, OAuth profiles, saved credentials, and
runtime tools remain unchanged. This is not an access-control restriction.

Keep verification instances pinned to their pre-hold app release so reviewers
can still find and test the integrations. After approval, remove the page's
`GOOGLE_CONNECTOR_SLUGS` filter and update its visibility tests before upgrading
those instances. Do not disable the shared definitions to control this page's
visibility.

## Developer Preview enrollment

Google grants preview access to the specific Workspace email addresses and
Google Cloud project numbers registered with the program. Submitting the form
is not the approval signal:

1. Google first sends a Google Group membership notification after verifying
   the Workspace account.
2. Google then sends a final confirmation after registering the Cloud project,
   usually within a couple of days. This final email is the signal that MCP
   testing can begin.
3. If no final confirmation arrives within a week, check spam and contact the
   Developer Preview program team from the
   [program page](https://developers.google.com/workspace/preview).

Enrollment does not authorize every user of an OAuth client. Additional tester
emails and Cloud projects must be added through Google's member request forms.
Google's preview terms also prohibit making a pre-GA integration available to
end users outside the enrolled company or domain unless Google grants explicit
permission. Each company enrolls its own Workspace testers and Cloud project and
uses its own OAuth app until Google makes Workspace MCP generally available.

## App matrix

| App card | MCP endpoint | Capability choices |
| --- | --- | --- |
| Gmail | `https://gmailmcp.googleapis.com/mcp/v1` | Read only; read and create drafts |
| Google Drive | `https://drivemcp.googleapis.com/mcp/v1` | Read only; read and create files |
| Google Docs | `https://docsmcp.googleapis.com/mcp/v1` | Read only; read and edit |
| Google Sheets | `https://sheetsmcp.googleapis.com/mcp/v1` | Read only; read and edit; share selected sheets with the robot account |
| Google Slides | `https://slidesmcp.googleapis.com/mcp/v1` | Read only; read and edit |
| Google Calendar | `https://calendarmcp.googleapis.com/mcp/v1` | Read only; read and manage events |
| Google Chat | `https://chatmcp.googleapis.com/mcp/v1` | Read only; read and send messages |
| Google People | `https://people.googleapis.com/mcp/v1` | Read contacts |
| Google Workspace Search | `https://workspacemcp.googleapis.com/mcp/v1` | Search Workspace |

The setup flow asks for the capability first. The available authentication
methods are:

- **Use your own Google OAuth app** uses customer-supplied OAuth credentials and
  the app definition's exact reviewed scopes. The client's redirect URI is the
  instance callback `/api/tools/oauth/callback`; see [Gmail
  connection](./GMAIL.md) for the client setup steps shared by every app.
- **Use the robot account** remains an additional Google Sheets-only option for
  explicitly shared spreadsheets.

Before Google consent, the setup flow asks whether the credential is for just
the connecting user or for any human in the company. A personal choice stores
the tokens only on that user's grant. A company choice stores them on the
default organization grant, while still recording which signed-in Google
principal completed consent so refresh and reconnect stay bound to that
principal.

Switching capability or authentication methods preserves the selected credential
owner when the new method supports that owner.

## Safety boundary

Every Google profile has an explicit MCP tool allowlist. Unknown Developer
Preview tools default to disabled. Read profiles expose only reviewed read
operations. Write profiles add only the reviewed write operations for their app;
destructive or unreviewed tools do not become available merely because Google
adds them upstream.

### Service-specific minimum scopes (2026-09-30)

Docs, Sheets, and Slides request only their service's read-only scope in the
read profile and its read/write scope in the write profile. They do not also
request `drive.readonly` or `drive.file`: those are authorization alternatives,
not additional requirements. Drive and Workspace Search retain their separate
Drive permissions. Calendar write requests `calendar.calendarlist.readonly`
and `calendar.events`; the latter also authorizes `suggest_time`. Calendar read
retains `calendar.events.freebusy` alongside list/event read-only access.

References: Google's [Docs read](https://developers.google.com/workspace/docs/api/reference/mcp/tools_list/read_doc)
and [update](https://developers.google.com/workspace/docs/api/reference/mcp/tools_list/update_doc),
[Sheets read](https://developers.google.com/workspace/sheets/api/reference/mcp/tools_list/get_spreadsheet)
and [update](https://developers.google.com/workspace/sheets/api/reference/mcp/tools_list/update_values),
[Slides read](https://developers.google.com/workspace/slides/api/reference/mcp/tools_list/read_presentation)
and [update](https://developers.google.com/workspace/slides/api/reference/mcp/tools_list/update_presentation),
and [Calendar suggest_time](https://developers.google.com/workspace/calendar/api/v3/reference/mcp/tools_list/suggest_time).

The write scopes support editing existing accessible files by ID. `drive.file`
is a valid narrower alternative for app-authorized files, but would require a
different per-file authorization workflow. Read-only profiles remain separate;
the project-wide union is not the scope set requested by every connection.

Test fresh grants before production. Reconnect affected connections; do not
relabel or globally revoke existing tokens. Customer-owned methods request the
reduced sets on new consent; previously issued grants are not retroactively
narrowed. The 21-scope integration
union is unchanged by these profile-level reductions. Console must still keep
Drive/free-busy entries required by other profiles and separately used identity
scopes. Fresh provider proof is a release requirement, not implied by unit tests.

### Google Chat scope reduction (2026-09-22)

`chat.read` requests only `chat.spaces.readonly` and `chat.messages.readonly`.
`chat.write` adds `chat.messages.create`. Neither requests `chat.memberships.readonly`
nor `chat.users.readstate.readonly`.

Conversation lookup, message history, ordinary message search, and the write
profile's message sending remain supported. Membership listing and marking
messages read/unread remain outside the tool allowlist. `search_messages`
cannot filter by read state: the app hides `isUnread` from its agent and Test
schemas and rejects any explicit `isUnread`/`is_unread` argument, including
`false` or `null`, before dispatch. It never silently drops the filter. The
guard also applies to cached catalogs and existing broader grants.

References: Google's [Chat MCP setup](https://developers.google.com/workspace/chat/api/guides/configure-mcp-server)
and [message-search parameters](https://developers.google.com/workspace/chat/api/reference/mcp/tools_list/search_messages).

Existing Google tokens are not retroactively narrowed or revoked by this code
change; reconnect affected Chat grants for new consent. Do not revoke the
shared Google client to migrate one profile, because that can break other
Workspace connections. After deployment, verify fresh reduced-scope consent,
ordinary Chat search/history and sending, then reconcile Google Console and
the verification evidence with the deployed scope set.
