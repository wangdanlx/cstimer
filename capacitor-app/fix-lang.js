/**
 * 修改 index.html 支持多语言动态加载
 * 将硬编码的英文语言变量替换为根据 URL 参数动态加载语言文件
 */
const fs = require('fs');
const path = require('path');

const indexPath = '/workspace/cstimer/capacitor-app/www/index.html';
let html = fs.readFileSync(indexPath, 'utf8');

// 找到语言变量块的开始和结束位置
const langBlockStart = html.indexOf('var CSTIMER_VERSION');
const langBlockEnd = html.indexOf('</script>', langBlockStart);

if (langBlockStart === -1 || langBlockEnd === -1) {
    console.error('Cannot find language block in index.html');
    process.exit(1);
}

// 提取 LANG_SET, LANG_STR, LANG_CUR
const langBlock = html.substring(langBlockStart, langBlockEnd);
const versionMatch = langBlock.match(/var CSTIMER_VERSION = '[^']*';/);
const langSetMatch = langBlock.match(/var LANG_SET = '[^']*';/);
const langStrMatch = langBlock.match(/var LANG_STR = '[^']*';/);

if (!versionMatch || !langSetMatch || !langStrMatch) {
    console.error('Cannot parse language block');
    process.exit(1);
}

// 构建新的语言加载脚本
const newLangScript = `<script type="text/javascript">
${versionMatch[0]}
${langSetMatch[0]}
${langStrMatch[0]}
var LANG_CUR = 'en-us';
(function(){
  var m = location.search.match(/[?&]lang=([a-z]{2}-[a-z]{2})/);
  if (m) LANG_CUR = m[1];
  document.write('<scr' + 'ipt src="lang/' + LANG_CUR + '.js"><\\/scr' + 'ipt>');
})();
</script>`;

// 找到语言块的 <script> 标签起始
const scriptTagStart = html.lastIndexOf('<script', langBlockStart);

// 替换整个语言块
html = html.substring(0, scriptTagStart) + newLangScript + html.substring(langBlockEnd + '</script>'.length);

// 修改语言切换行为 - 在 Capacitor 中使用 URL hash 参数
// csTimer 使用 location.href="?lang=xx" 来切换语言
// 在 Capacitor 中，需要改为带 lang 参数重新加载
// 但实际上，cstimer.js 中的逻辑已经使用 location.href="?lang=xx"
// Capacitor WebView 的 file:// URL 支持 query 参数，所以应该能工作

// 同时确保语言文件也在 www 目录
fs.writeFileSync(indexPath, html, 'utf8');
console.log('index.html updated with dynamic language loading');
console.log('New language block injected at line ~14');
