// Display-only inventory: this is deliberately not a D1 app grant.
// The owner route reuses the existing owner-hub Access audience.
export const MCP_MANAGEMENT_CATALOG = Object.freeze({
  id: 'mcp-manager',
  name: 'MTerm-CLI Manager',
  href: '/admin/mcp',
  access_mode: 'owner_only',
  managed: 0,
  description: 'MTerm-CLI workstation connector management, currently backed by the shared Desktop Commander bridge. Independent of MJobs.',
  limitation: 'Owner only. Website application grants do not authorize local files, terminals or MCP tools. Only explicitly managed wrappers honor the local policy; hosted and unmanaged servers keep their own controls.',
});
