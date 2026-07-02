const fs = require('fs');
const path = require('path');

const adminDir = path.join(__dirname, '../src/admin');
const files = fs.readdirSync(adminDir).filter((f) => f.endsWith('.js'));

function fixContent(content) {
  content = content.replace(/adminSiteFetchInit\(\s*\?\s*\{\s*json:\s*\.json\s*\}\s*:\s*\{\}\)/g, 'adminSiteFetchInit()');

  content = content.replace(
    /fetch\(([^,]+), \{\s*headers: adminSiteFetchInit\(\)\s*\}\)/g,
    'fetch($1, adminSiteFetchInit())'
  );

  content = content.replace(
    /fetch\(([^,]+), \{\s*method: ([^,]+),\s*headers: adminSiteFetchInit\(\),\s*body: ([\s\S]*?)\}\)/g,
    'fetch($1, adminSiteFetchInit({ method: $2, body: $3 }))'
  );

  content = content.replace(
    /fetch\(([^,]+), \{\s*method: ([^,]+),\s*headers: adminSiteFetchInit\(\)\s*\}\)/g,
    'fetch($1, adminSiteFetchInit({ method: $2 }))'
  );

  content = content.replace(
    /headers: \{ \.\.\.adminSiteFetchInit\(\), 'Content-Type': 'application\/json' \}/g,
    '...adminSiteFetchInit().headers'
  );

  return content;
}

for (const name of files) {
  const filePath = path.join(adminDir, name);
  const before = fs.readFileSync(filePath, 'utf8');
  const after = fixContent(before);
  if (after !== before) {
    fs.writeFileSync(filePath, after, 'utf8');
    console.log('fixed', name);
  }
}
