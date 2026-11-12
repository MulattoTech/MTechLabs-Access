---
name: mterm-connection-recovery
description: Diagnose MTerm-CLI connection failures, distinguish backend health from authenticated access in the current chat, and guide supported recovery while preserving the working connection.
---

# Diagnose and recover MTerm-CLI

## Check the active connection

Distinguish backend health, tool availability in this conversation, and a
successful authenticated MCP tool call. A healthy endpoint or advertised tool list
alone does not prove ChatGPT authorization.

When a connection check is requested, use the available `get_file_info` tool on
an existing file the owner has identified or already authorized within a permitted
root. Read metadata only. Ask for a suitable path only if none is known. If the
tool is unavailable, report that limitation instead of claiming a successful test.

Scope a successful check to the active tool path, conversation, and time. The
canonical plugin and Live Connection wrapper share an App binding; a working call
when both are enabled does not prove canonical-only authorization. Preserve the
working wrapper until replacement access is independently verified.

## Use supported recovery controls

The owner-only manager is <https://m-techlabs.com/admin/mcp>. The existing private
plugin is
<https://chatgpt.com/plugins/plugins_6aed1a85300481919559498b458ed278>.
Its MCP endpoint is `https://mcp.m-techlabs.com/mcp`, using OAuth and dynamic
client registration.

Use only the Connect, Reconnect, or authorization controls actually offered by
the current ChatGPT client, with the owner's interactive consent where required.
If no supported connection control is available, record the client/account
limitation and retain the working connection. Do not uninstall or re-create a
working entry merely because reconnect is unavailable. Repeat the bounded
read-only check after a supported authorization change.

## Keep release and service boundaries clear

A package update cannot reset account consent, create a native ChatGPT reconnect
button, or prove an authenticated connection. The website archive and installed
plugin are separate release channels; verify the specific archive's version and
checksum before using it.

During an installation-only investigation, preserve the local manager,
configuration, Cloudflare Tunnel, and authentication policy. Never place service
tokens or OAuth secrets in plugin files, downloads, tool arguments, or chat.
