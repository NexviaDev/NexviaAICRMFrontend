const fs = require('fs');
const path = require('path');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|jsx)$/.test(name)) out.push(p);
  }
  return out;
}

const src = path.join(__dirname, '../src');
for (const file of walk(src)) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes('crmFetchInit')) continue;
  const hasImport =
    /import\s*\{[^}]*\bcrmFetchInit\b[^}]*\}\s*from\s*['"]@\/lib\/crm-auth['"]/.test(text) ||
    /import\s*\{[^}]*\bcrmFetchInit\b[^}]*\}\s*from\s*['"]\.\.?\/.*crm-auth/.test(text);
  if (!hasImport) {
    console.log(path.relative(src, file));
  }
}
