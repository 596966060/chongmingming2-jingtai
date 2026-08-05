/**
 * highPrecision.js
 * 高精度模式 —— 前端识别缺字段时调用后端 EasyOCR 补刀
 *
 * 后端接口（对齐 Python high_precision_server.py）:
 *   POST { file: <File> }  →  JSON { data, type, text }
 */

let HP_URL = '';
let HP_ENABLED = false;

export function initHighPrecision() {
  const toggle = document.getElementById('highPrecisionToggle');
  const urlInput = document.getElementById('highPrecisionUrl');

  // 从 localStorage 恢复
  const savedUrl = localStorage.getItem('hp_url');
  if (savedUrl && urlInput) urlInput.value = savedUrl;
  const savedOn = localStorage.getItem('hp_on') === '1';
  if (savedOn && toggle) toggle.checked = true;
  HP_URL = savedUrl || '';
  HP_ENABLED = savedOn;

  if (toggle) {
    toggle.addEventListener('change', () => {
      HP_ENABLED = toggle.checked;
      localStorage.setItem('hp_on', HP_ENABLED ? '1' : '0');
      toast(HP_ENABLED ? '🎯 高精度模式已开启' : '🎯 高精度模式已关闭');
    });
  }
  if (urlInput) {
    urlInput.addEventListener('change', () => {
      HP_URL = urlInput.value.trim().replace(/\/$/, '');
      localStorage.setItem('hp_url', HP_URL);
      toast('🔗 高精度服务器地址已保存');
    });
  }
}

export function isHighPrecisionEnabled() {
  return HP_ENABLED && !!HP_URL;
}

export async function highPrecisionExtract(file) {
  if (!HP_URL) throw new Error('高精度服务器地址未设置');
  const fd = new FormData();
  fd.append('file', file);

  const resp = await fetch(`${HP_URL}/api/extract`, {
    method: 'POST',
    body: fd
  });
  if (!resp.ok) throw new Error(`高精度后端错误: ${resp.status}`);
  return await resp.json();
}
