const fs = require('fs');
const path = require('path');

const adminDir = path.join(__dirname, '../src/admin');
const files = fs.readdirSync(adminDir).filter((f) => f.endsWith('.js'));

for (const name of files) {
  const filePath = path.join(adminDir, name);
  let content = fs.readFileSync(filePath, 'utf8');
  const before = content;
  if (!content.includes('getAdminSiteFetchHeaders')) continue;

  if (!content.includes('adminSiteFetchInit')) {
    content = content.replace(
      "import { getAdminSiteFetchHeaders } from '@/lib/admin-site-headers';",
      "import { adminSiteFetchInit } from '@/lib/admin-site-headers';"
    );
    content = content.replace(
      'from \'@/lib/admin-site-headers\';',
      "from '@/lib/admin-site-headers';\nimport { adminSiteFetchInit } from '@/lib/admin-site-headers';"
    );
    // dedupe if double import
    content = content.replace(
      /import \{ adminSiteFetchInit \} from '@\/lib\/admin-site-headers';\nimport \{ adminSiteFetchInit \} from '@\/lib\/admin-site-headers';/,
      "import { adminSiteFetchInit } from '@/lib/admin-site-headers';"
    );
  }

  content = content.replace(
    /\{ headers: getAdminSiteFetchHeaders\(([^)]*)\) \}/g,
    'adminSiteFetchInit($1 ? { json: $1.json } : {})'
  );
  content = content.replace(
    /\{ headers: \{ \.\.\.getAdminSiteFetchHeaders\(\), 'Content-Type': 'application\/json' \} \}/g,
    "adminSiteFetchInit()"
  );
  content = content.replace(/getAdminSiteFetchHeaders/g, 'adminSiteFetchInit');

  if (content !== before) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('patched', name);
  }
}
