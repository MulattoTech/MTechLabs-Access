const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const CONFIGURATION_PREFIX = 'Current configuration:\n';

// Desktop Commander 0.3.1 dist/tools/config.js returns the configuration in
// structuredContent.config and in a prefixed text block. Its internal error
// fallback has no isError flag, so a non-error MCP response alone is not enough.
// Return only a boolean; never expose configuration values or parse exceptions.
export function hasConfigurationObject(result) {
  if (!isObject(result) || result.isError === true) return false;
  if (isObject(result.structuredContent) && Object.hasOwn(result.structuredContent, 'config')) {
    return isObject(result.structuredContent.config);
  }
  if (!Array.isArray(result.content)) return false;
  for (const block of result.content) {
    if (block?.type !== 'text' || typeof block.text !== 'string' || !block.text.startsWith(CONFIGURATION_PREFIX)) continue;
    try { if (isObject(JSON.parse(block.text.slice(CONFIGURATION_PREFIX.length)))) return true; }
    catch { /* Unrecognized content is a failed check, not a diagnostic payload. */ }
  }
  return false;
}
