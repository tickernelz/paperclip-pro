# Web Terminal

Paperclip has a browser terminal: a full xterm session in the app, opened from **Terminal** in the sidebar or from the task drawer. It runs either a shell on the Paperclip host or an SSH session to a registered environment.

## Who can open what

| Session kind | Allowed for |
|---|---|
| `local` (shell on this host) | `local_trusted` operators, and instance admins signed in through the browser |
| `ssh` (registered environment) | active, non-viewer company members signed in through the browser |

Agents, company-owner agents, board API keys, and MCP OAuth tokens are refused for both kinds. A non-admin member sees no local option; the server is the authority and returns 403 for any local action they attempt.

A local shell runs as the user that runs Paperclip, so it can read anything that user can read, including other companies' data on the same host. That is why it is limited to instance admins.

## Origins

Every mutating route and the WebSocket upgrade require a trusted origin:

- `auth.publicBaseUrl` and `PAPERCLIP_PUBLIC_URL`, matched exactly
- each `server.allowedHostnames` entry, over https on the default port only
- the server's own address, `http://<bind host>:<listen port>`, for local use

A missing `Origin` is accepted only in `local_trusted` mode. A Vite dev server on another port is not a trusted origin.

Behind a reverse proxy or tunnel, set `auth.publicBaseUrl` to the public URL and let the proxy pass the public `Host` through, because the upgrade check reads the raw `Host` header.

## Sessions

- A session keeps running when the tab closes. Reopening the terminal reattaches and replays the recent screen (up to 2 MiB of scrollback).
- A session with no attached client for 24 hours is killed. All sessions end when the service restarts.
- Closing a session sends SIGHUP to the shell's whole process group and session, then SIGKILL after 2 seconds, so background jobs do not outlive it.
- Limits: 16 running sessions per user, 64 per company.
- A terminal opened from a task starts in that task's execution workspace (`providerRef`, then `cwd`), then the project workspace, then the home directory.

## Access over the life of a session

- An attach token is single-use, valid for 60 seconds, and sent only in the first WebSocket frame, never in the URL.
- Access is checked when the token is minted, again when the socket attaches, and every 60 seconds afterwards against the database: role, membership, and the login session that minted the token. Losing any of them closes the socket.
- Opening, attaching, closing, uploading, and downloading are written to the activity log.

## Terminal features

- WebGL rendering with a fallback when WebGL is unavailable
- inline images over Sixel and the iTerm2 protocol
- clickable links, search (Ctrl/Cmd+F), copy and paste (Ctrl+Shift+C/V)
- tabs and a side-by-side split
- drag a file onto the terminal to upload it into the session's directory; download a file by path

Uploads never overwrite an existing file and cannot leave the session's directory. Output that asks for the clipboard (OSC 52 read) gets an empty answer, so a program in the terminal cannot read your clipboard; programs can still copy into it.
