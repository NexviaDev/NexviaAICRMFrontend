const fs = require('fs');
const path = require('path');

const srcRoot = path.join(__dirname, '../src');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|jsx)$/.test(name)) out.push(p);
  }
  return out;
}

const LOCAL_GET_AUTH = /function getAuthHeader\(\) \{\s*(?:const token = getCrmToken\(\);\s*return token \? \{ \.\.\.getCrmAuthHeaders\(\)(?:,\s*'Content-Type':\s*'application\/json')? \} : \{(?:\s*'Content-Type':\s*'application\/json')?\s*\};|return \{\};)\s*\}\s*/g;

const EXPORT_GET_AUTH = /export function getAuthHeader\(\) \{\s*const token = getCrmToken\(\);\s*return token \? \{ \.\.\.getCrmAuthHeaders\(\) \} : \{\};\s*\}\s*/g;

function ensureImport(content, symbol) {
  if (content.includes(`import {`) && content.includes(symbol)) {
    const m = content.match(/import \{([^}]+)\} from '@\/lib\/crm-auth';/);
    if (m && !m[1].includes(symbol)) {
      const parts = m[1].split(',').map((s) => s.trim()).filter(Boolean);
      if (!parts.includes(symbol)) parts.push(symbol);
      return content.replace(m[0], `import { ${parts.join(', ')} } from '@/lib/crm-auth';`);
    }
    return content;
  }
  const importLine = `import { ${symbol} } from '@/lib/crm-auth';\n`;
  const apiImport = content.match(/^import .+ from '@\/config';/m);
  if (apiImport) {
    return content.replace(apiImport[0], `${apiImport[0]}\n${importLine.trim()}`);
  }
  return importLine + content;
}

function fixFetchPatterns(content) {
  let c = content;

  c = c.replace(/\{\s*headers:\s*getAuthHeader\(\)\s*,\s*credentials:\s*'include'\s*\}/g, 'crmFetchInit()');
  c = c.replace(/\{\s*credentials:\s*'include'\s*,\s*headers:\s*getAuthHeader\(\)\s*\}/g, 'crmFetchInit()');
  c = c.replace(/\{\s*headers:\s*getAuthHeader\(\)\s*\}/g, 'crmFetchInit()');

  c = c.replace(
    /\{\s*method:\s*('(?:DELETE|PATCH|POST|PUT)'|"(?:DELETE|PATCH|POST|PUT)"),\s*headers:\s*getAuthHeader\(\)\s*\}/g,
    'crmFetchInit({ method: $1 })'
  );

  c = c.replace(
    /\{\s*method:\s*('(?:DELETE|PATCH|POST|PUT)'|"(?:DELETE|PATCH|POST|PUT)"),\s*headers:\s*\{\s*'Content-Type':\s*'application\/json',\s*\.\.\.getAuthHeader\(\)\s*\},\s*body:\s*([^}]+)\}\)/gs,
    'crmFetchInit({ method: $1, headers: { \'Content-Type\': \'application/json\' }, body: $2 }))'
  );

  c = c.replace(
    /\{\s*headers:\s*\{\s*'Content-Type':\s*'application\/json',\s*\.\.\.getAuthHeader\(\)\s*\},\s*body:\s*([^}]+)\}\)/gs,
    'crmFetchInit({ headers: { \'Content-Type\': \'application/json\' }, body: $1 }))'
  );

  c = c.replace(
    /\{\s*method:\s*([^,]+),\s*headers:\s*\{\s*'Content-Type':\s*'application\/json',\s*\.\.\.getAuthHeader\(\)\s*\},\s*body:\s*([^}]+)\}\)/gs,
    'crmFetchInit({ method: $1, headers: { \'Content-Type\': \'application/json\' }, body: $2 }))'
  );

  c = c.replace(/\{\s*headers:\s*\{\s*\.\.\.getAuthHeader\(\)\s*\}\s*\}/g, 'crmFetchInit()');
  c = c.replace(/\{\s*headers:\s*\{\s*\.\.\.getAuthHeader\(\)\s*\},\s*credentials:\s*'include'\s*\}/g, 'crmFetchInit()');

  c = c.replace(
    /\{\s*method:\s*('POST'|"POST"),\s*headers:\s*\{\s*'Content-Type':\s*'application\/json',\s*\.\.\.getAuthHeader\(\)\s*\},\s*body:\s*JSON\.stringify\(([^)]+)\)\s*\}/g,
    'crmFetchInit({ method: $1, headers: { \'Content-Type\': \'application/json\' }, body: JSON.stringify($2) })'
  );

  c = c.replace(
    /\{\s*method:\s*('DELETE'|"DELETE"),\s*headers:\s*getAuthHeader\(\),\s*credentials:\s*'include'\s*\}/g,
    "crmFetchInit({ method: 'DELETE' })"
  );

  c = c.replace(
    /\{\s*headers:\s*\{\s*'Content-Type':\s*'application\/json',\s*\.\.\.getAuthHeader\(\)\s*\},\s*body:\s*([^}]+)\}/g,
    "crmFetchInit({ headers: { 'Content-Type': 'application/json' }, body: $1 })"
  );

  c = c.replace(
    /\{\s*headers:\s*\{\s*\.\.\.getAuthHeader\(\),\s*'Content-Type':\s*'application\/json'\s*\},\s*body:\s*([^}]+)\}/g,
    "crmFetchInit({ headers: { 'Content-Type': 'application/json' }, body: $1 })"
  );

  c = c.replace(
    /\{\s*method:\s*([^,]+),\s*headers:\s*\{\s*\.\.\.getAuthHeader\(\),\s*'Content-Type':\s*'application\/json'\s*\},\s*body:\s*([^}]+)\}/g,
    'crmFetchInit({ method: $1, headers: { \'Content-Type\': \'application/json\' }, body: $2 })'
  );

  c = c.replace(
    /\{\s*headers:\s*\{\s*\.\.\.getAuthHeader\(\)\s*\}\s*\}/g,
    'crmFetchInit()'
  );

  c = c.replace(
    /\{\s*headers:\s*getAuthHeader\(\),\s*body:\s*([^}]+)\}/g,
    'crmFetchInit({ body: $1 })'
  );

  c = c.replace(
    /fetch\(([^,]+), \{\s*headers:\s*getAuthHeader\(\),\s*signal:\s*([^}]+)\}\)/g,
    'fetch($1, { ...crmFetchInit(), signal: $2 })'
  );

  return c;
}

function cleanupImports(content) {
  const usesCrmFetch = content.includes('crmFetchInit(');
  const usesGetAuth = /\bgetAuthHeader\b/.test(content);
  const usesGetCrmToken = /\bgetCrmToken\b/.test(content);
  const usesGetCrmAuthHeaders = /\bgetCrmAuthHeaders\b/.test(content);
  const usesHasCrmSession = /\bhasCrmSession\b/.test(content);

  const needed = new Set();
  if (usesCrmFetch) needed.add('crmFetchInit');
  if (usesGetAuth && !content.includes("from '@/lib/crm-auth'")) needed.add('getAuthHeader');
  if (usesGetCrmToken) needed.add('getCrmToken');
  if (usesGetCrmAuthHeaders) needed.add('getCrmAuthHeaders');
  if (usesHasCrmSession) needed.add('hasCrmSession');

  return content;
}

let changed = 0;
for (const filePath of walk(srcRoot)) {
  if (filePath.includes(`${path.sep}lib${path.sep}crm-auth.js`)) continue;

  let content = fs.readFileSync(filePath, 'utf8');
  const before = content;

  if (EXPORT_GET_AUTH.test(content)) {
    content = content.replace(EXPORT_GET_AUTH, "export { getAuthHeader } from '@/lib/crm-auth';\n");
  }

  content = content.replace(LOCAL_GET_AUTH, '');
  content = fixFetchPatterns(content);

  if (content.includes('crmFetchInit(')) {
    content = ensureImport(content, 'crmFetchInit');
  }
  if (/\bgetAuthHeader\b/.test(content) && !content.includes("export { getAuthHeader }")) {
    const hasLocal = /function getAuthHeader/.test(content);
    if (!hasLocal) content = ensureImport(content, 'getAuthHeader');
  }

  if (content !== before) {
    fs.writeFileSync(filePath, content, 'utf8');
    changed += 1;
    console.log('fixed', path.relative(srcRoot, filePath));
  }
}

console.log('done', changed, 'files');
