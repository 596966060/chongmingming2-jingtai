/**
 * highPrecision.js
 * 高精度模式 —— 前端识别缺字段时调用后端 EasyOCR 补刀
 *
 * 挂载到全局: window.HP
 *
 * 后端接口:
 *   POST /api/extract  (multipart/form-data, field: file)
 *   →  JSON { type, text, fields }
 */

(function (global) {

  var HP_URL = '';
  var HP_ENABLED = false;

  function initHighPrecision() {
    var toggle  = document.getElementById('highPrecisionToggle');
    var urlInput = document.getElementById('highPrecisionUrl');

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

  global.HP = {
    init:    initHighPrecision,
    isEnabled: isHighPrecisionEnabled,
    extract:  highPrecisionExtract
  };

})(window);

/**
 * highPrecision.js - 增加测试连接
 */
(function(global) {
  var HP_URL = '';
  var HP_ENABLED = false;

  function init() {
    var toggle = document.getElementById('highPrecisionToggle');
    var urlInput = document.getElementById('highPrecisionUrl');
    var testBtn = document.getElementById('testBackendBtn');

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
        if (global.toast) global.toast('🔗 后端地址已保存');
      });
    }
    // 测试按钮
    if (testBtn) {
      testBtn.addEventListener('click', function() {
        var url = HP_URL || urlInput.value.trim().replace(/\/$/, '');
        if (!url) {
          toast('请先输入后端地址');
          return;
        }
        testBackend(url);
      });
    }
  }

  function testBackend(url) {
    toast('⏳ 正在测试连接...');
    fetch(url + '/health', { method: 'GET', signal: AbortSignal.timeout(5000) })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'ok') {
          toast('✅ 后端连接成功！');
        } else {
          toast('⚠️ 后端响应异常: ' + JSON.stringify(data));
        }
      })
      .catch(err => {
        toast('❌ 连接失败: ' + err.message + ' (请检查地址是否正确)');
      });
  }

  function isEnabled() {
    return HP_ENABLED && !!HP_URL;
  }

  // 批量处理文件
  function processFiles(files) {
    if (!HP_URL) return Promise.reject(new Error('未设置后端地址'));
    var fd = new FormData();
    for (var i = 0; i < files.length; i++) {
      fd.append('files[]', files[i]);
    }
    return fetch(HP_URL + '/api/upload', {
      method: 'POST',
      body: fd
    }).then(function(resp) {
      if (!resp.ok) {
        return resp.json().then(function(err) {
          throw new Error(err.error || '后端错误');
        });
      }
      return resp.json();
    });
  }

  global.HP = {
    init: init,
    isEnabled: isEnabled,
    processFiles: processFiles,
    testBackend: testBackend
  };
})(window);
