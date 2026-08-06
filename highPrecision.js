/**
 * highPrecision.js
 * 高精度模式 —— 前端识别缺字段时调用后端 EasyOCR 补刀
 *
 * 挂载到全局: window.HP
 *
 * 后端接口（对齐 Python high_precision_server.py）:
 *   POST { file: <File> }  →  JSON { data, type, text }
 */

(function (global) {

  var HP_URL = '';
  var HP_ENABLED = false;

  function initHighPrecision() {
    var toggle  = document.getElementById('highPrecisionToggle');
    var urlInput = document.getElementById('highPrecisionUrl');

    // 从 localStorage 恢复
    try {
      var savedUrl = localStorage.getItem('hp_url');
      if (savedUrl && urlInput) urlInput.value = savedUrl;
      var savedOn = localStorage.getItem('hp_on') === '1';
      if (savedOn && toggle) toggle.checked = true;
      HP_URL = savedUrl || '';
      HP_ENABLED = savedOn;
    } catch(e) {}

    if (toggle) {
      toggle.addEventListener('change', function() {
        HP_ENABLED = toggle.checked;
        try { localStorage.setItem('hp_on', HP_ENABLED ? '1' : '0'); } catch(e) {}
        if (global.toast) global.toast(HP_ENABLED ? '🎯 高精度模式已开启' : '🎯 高精度模式已关闭');
      });
    }
    if (urlInput) {
      urlInput.addEventListener('change', function() {
        HP_URL = urlInput.value.trim().replace(/\/$/, '');
        try { localStorage.setItem('hp_url', HP_URL); } catch(e) {}
        if (global.toast) global.toast('🔗 高精度服务器地址已保存');
      });
    }
  }

  function isHighPrecisionEnabled() {
    return HP_ENABLED && !!HP_URL;
  }

  function highPrecisionExtract(file) {
    if (!HP_URL) return Promise.reject(new Error('高精度服务器地址未设置'));
    var fd = new FormData();
    fd.append('file', file);
    return fetch(HP_URL + '/api/extract', { method: 'POST', body: fd }).then(function(resp) {
      if (!resp.ok) throw new Error('高精度后端错误: ' + resp.status);
      return resp.json();
    });
  }

  // 暴露到全局
  global.HP = {
    init:    initHighPrecision,
    isEnabled: isHighPrecisionEnabled,
    extract:  highPrecisionExtract
  };

})(window);
