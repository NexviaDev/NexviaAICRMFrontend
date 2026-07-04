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

function fixContent(content) {
  return content.replace(
    /JSON\.stringify\((\{[\s\S]*?\})\s*\)\)\s*\n(\s*)\}\);/g,
    (match, obj, indent) => `JSON.stringify(${obj})\n${indent}}));`
  );
}

let changed = 0;
for (const filePath of walk(srcRoot)) {
  const before = fs.readFileSync(filePath, 'utf8');
  const after = fixContent(before);
  if (after !== before) {
    fs.writeFileSync(filePath, after, 'utf8');
    changed += 1;
    console.log('fixed', path.relative(srcRoot, filePath));
  }
}
console.log('done', changed, 'files');
