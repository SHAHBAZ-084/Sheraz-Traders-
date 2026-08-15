/**
 * Second-pass cleanup for adapted accounting.service.ts
 */
const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '../src/modules/accounting/accounting.service.ts');
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/, mode: 'insensitive'/g, '');
content = content.replace(/BRANCH_DEFAULT_CATEGORY_NAMES/g, 'DEFAULT_CATEGORY_NAMES');

fs.writeFileSync(file, content);
console.log('Cleaned accounting.service.ts');
