# MTerm-CLI private ChatGPT plugin

This package contains the private ChatGPT plugin source for the existing MTerm-CLI
workstation service. Read the package version from `plugin.json`. This source
archive is not a Windows installer, and available installation controls depend on
the ChatGPT account and client.

## Manage the connection

Open the owner-only manager at <https://m-techlabs.com/admin/mcp> for configuration
and its **Plugin & recovery** section. The existing private plugin entry is
<https://chatgpt.com/plugins/plugins_6aed1a85300481919559498b458ed278>.
The MCP endpoint is `https://mcp.m-techlabs.com/mcp`, with OAuth and dynamic client
registration.

The installed ChatGPT plugin and the website's downloadable archive are separate
release channels. Check the version and checksum of the specific archive before
using it. A plugin update does not prove that the website serves that release or
that a ChatGPT authorization grant has changed.

## Verify access in the current chat

Distinguish backend health, the tools available in this conversation, and an
authenticated tool call. Each answers a different question.

For a read-only connection check, use the available `get_file_info` tool on an
existing file the owner has identified or already authorized within a permitted
root. Keep the check to file metadata. If no suitable path is known, obtain one
from the owner; if the tool is unavailable, report that limit without inventing a
successful check.

A successful call verifies the active tool path in this chat at that time. It does
not prove that another plugin entry, chat, or client has authorization. When both
the canonical plugin and Live Connection wrapper are enabled, a shared App binding
does not establish which entry supplies the working grant. Canonical-only access
must be independently verified before considering removal of the working wrapper.

## Recover an unavailable connection

1. Open the existing plugin entry and use the actual **Connect**, **Reconnect**, or
   authorization control offered by that client. Complete the owner's interactive
   OAuth consent when required.
2. If no supported connection control is available, record the observed client and
   account limitation and retain the working connection. Do not uninstall or
   re-create a working entry merely because a reconnect button is absent.
3. After a supported connection or authorization change, repeat the bounded
   read-only check and report exactly which chat and tool path was tested.

ChatGPT controls installation and account consent. MCP tools and a package update
cannot create a native reconnect button or reset that consent. Preserve the local
manager, its configuration, and Cloudflare Tunnel during a ChatGPT-side
installation investigation. Do not change authentication policy to work around a
missing client control. Never place service tokens or OAuth secrets in plugin
files, downloads, tool arguments, or chat.
