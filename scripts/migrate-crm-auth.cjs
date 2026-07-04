/**
 * One-time migration: localStorage crm_token -> crm-auth helpers
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../src');
const IMPORT_LINE = "import { hasCrmSession, getCrmToken, getCrmAuthHeaders, crmFetchInit, markCrmSessionActive, clearCrmSessionLocal, logoutCrmSession } from '@/lib/crm-auth';\n";

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|jsx)$/.test(name)) out.push(p);
  }
  return out;
}

function ensureImport(content) {
  if (content.includes("from '@/lib/crm-auth'") || content.includes('from "@/lib/crm-auth"')) {
    return content;
  }
  const m = content.match(/^import .+;\r?\n/m);
  if (m) return content.replace(m[0], m[0] + IMPORT_LINE);
  return IMPORT_LINE + content;
}

function migrateFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  const before = content;
  if (
    !content.includes("localStorage.getItem('crm_token')") &&
    !content.includes('localStorage.setItem(\'crm_token\'') &&
    !content.includes("localStorage.removeItem('crm_token')")
  ) {
    return false;
  }

  content = content.replace(/localStorage\.getItem\('crm_token'\)/g, 'getCrmToken()');
  content = content.replace(/localStorage\.setItem\('crm_token',\s*[^)]+\)/g, 'markCrmSessionActive()');
  content = content.replace(/localStorage\.removeItem\('crm_token'\)/g, '/* legacy crm_token removed */ void 0');

  // Authorization: `Bearer ${token}` when token is getCrmToken() — use cookie auth headers
  content = content.replace(
    /Authorization:\s*`Bearer \$\{([^}]+)\}`/g,
    (match, expr) => {
      const trimmed = expr.trim();
      if (trimmed === 'token' || trimmed === 'getCrmToken()' || trimmed === 'crmToken') {
        return '...getCrmAuthHeaders()';
      }
      return match;
    }
  );

  content = content.replace(
    /headers:\s*\{\s*\.\.\.getAuthHeader\(\),\s*'Content-Type':\s*'application\/json'\s*\}/g,
    "headers: { ...getCrmAuthHeaders(), 'Content-Type': 'application/json' }"
  );

  if (content !== before) {
    content = ensureImport(content);
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  }
  return false;
}

const files = walk(SRC);
let count = 0;
for (const f of files) {
  if (f.endsWith('crm-auth.js')) continue;
  if (migrateFile(f)) {
    count += 1;
    console.log('migrated', path.relative(SRC, f));
  }
}
console.log('done', count, 'files');
