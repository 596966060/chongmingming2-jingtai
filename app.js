/**
 * app.js
 * 主控制逻辑 —— 对齐原始 app.py 的 smart_extract → 命名 → 编辑 → 导出 流程
 *
 * 非模块写法，挂载到全局 window.APP
 *
 * 流程:
 *   1. 文件选择/拖拽 → handleFiles()
 *   2. EX.extractFromFile() → { data, type, text }
 *   3. FN.genAnyFilename() → 新文件名
 *   4. 表格渲染 + 手动编辑 → 重新命名
 *   5. ZIP / CSV / Excel 导出
 */

(function (global) {

  /* ========= 全局状态 ========= */

  var results = [];          // [{ file, data, type, newName, text }]
  var currentEditIndex = -1;
  var nameSet = {};

  /* ========= 初始化（不依赖 DOMContentLoaded） ========= */

  function init() {
    bindFileInput();
    bindDragDrop();
    bindButtons();
    HP.init();
  }

  // DOM 已就绪时立即初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ========= 文件选择 ========= */

  function bindFileInput() {
    var input   = document.getElementById('fileInput');
    var pickBtn = document.getElementById('pickFileBtn');
    var dropZone = document.getElementById('dropZone');
    if (!input) { console.error('fileInput 未找到'); return; }

    // "选择文件"按钮 → 触发 input
    if (pickBtn) {
      pickBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        // 关键：先清空 value 再 click，确保每次都能触发 change
        input.value = '';
        input.click();
      });
    }

    // 点击拖拽区（但不是点按钮）也可以选文件
    if (dropZone) {
      dropZone.addEventListener('click', function(e) {
        // 如果点的是按钮或 input 本身，不处理（按钮有自己的 handler）
        if (e.target === pickBtn) return;
        if (e.target === input) return;
        input.value = '';
        input.click();
      });
    }

    // input 选择文件后
    input.addEventListener('change', function(e) {
      if (e.target.files && e.target.files.length) {
        handleFiles(e.target.files);
      }
      // 清空，允许重复选同一文件
      e.target.value = '';
    });

    // 防止 input 在 dropZone 里被意外触发两次
    input.addEventListener('click', function(e) {
      e.stopPropagation();
    });
  }

  /* ========= 拖拽 ========= */

  function bindDragDrop() {
    var dropZone = document.getElementById('dropZone');
    if (!dropZone) return;

    // 阻止浏览器默认打开文件（文档级别）
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function(evt) {
      document.addEventListener(evt, function(e) { e.preventDefault(); });
    });

    // 拖拽进入/经过 → 高亮
    dropZone.addEventListener('dragover', function(e) {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });

    // 拖拽离开 → 取消高亮（只在离开 dropZone 本身时）
    dropZone.addEventListener('dragleave', function(e) {
      if (!dropZone.contains(e.relatedTarget)) {
        dropZone.classList.remove('drag-over');
      }
    });

    // 放下文件 → 处理
    dropZone.addEventListener('drop', function(e) {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        handleFiles(e.dataTransfer.files);
      }
    });
  }

  /* ========= 处理文件列表（核心流程） ========= */

  function handleFiles(files) {
    var fileArray = Array.prototype.filter.call(files, function(f) {
      return /\.(pdf|jpg|jpeg|png|bmp|tiff|tif|docx|zip)$/i.test(f.name);
    });

    if (!fileArray.length) {
      toast('请选择支持的发票/火车票/合同文件（PDF、图片、DOCX）');
      return;
    }

    var startIdx = results.length;
    updateFileHint(fileArray.length + ' 个文件已加入队列');

    // 逐个处理（用 Promise 链保证顺序）
    var chain = Promise.resolve();
    for (var i = 0; i < fileArray.length; i++) {
      (function(file, globalIdx) {
        chain = chain.then(function() {
          updateProgress(globalIdx - startIdx + 1, fileArray.length, file.name);
          return processOne(file, globalIdx);
        });
      })(fileArray[i], startIdx + i);
    }
    chain.then(function() {
      hideProgress();
      updateFileHint(results.length + ' 个文件已处理');
      var empty = document.querySelector('.empty-state');
      if (empty && empty.parentElement) empty.parentElement.style.display = 'none';
    });
  }

  function processOne(file, globalIdx) {
    return new Promise(function(resolve) {
      var ext = ((file.name || '').split('.').pop() || 'pdf').toLowerCase();

      // 1. ZIP 文件特殊处理
      if (ext === 'zip') {
        resolve(); // ZIP 暂不支持前端解包，标记跳过
        return;
      }

      // 2. 高精度后端（可选）
      var useHP = HP.isEnabled();

      function doFrontend() {
        if (!global.EX || !EX.extractFromFile) {
          console.error('extractors.js 未加载');
          results.push({ file: file, data: {}, type: 'error', newName: '识别失败', text: '', error: '引擎未加载' });
          addRow(globalIdx, file.name, '识别失败', 'error', {});
          updateStats();
          resolve();
          return;
        }
        EX.extractFromFile(file).then(function(result) {
          var data = result.data || {};
          var type = result.type || 'invoice';
          var text = result.text || '';

          // 3. 生成新文件名
          var newName = FN.genAnyFilename(data, type, file.name);
          newName = ensureUniqueName(newName, globalIdx);

          results.push({ file: file, data: data, type: type, newName: newName, text: text });
          addRow(globalIdx, file.name, newName, type, data);
          updateStats();
          resolve();
        }).catch(function(err) {
          console.error('处理失败:', file.name, err);
          results.push({ file: file, data: {}, type: 'error', newName: '识别失败', text: '', error: String(err) });
          addRow(globalIdx, file.name, '识别失败', 'error', {});
          updateStats();
          resolve();
        });
      }

      if (useHP) {
        HP.extract(file).then(function(hpResult) {
          if (hpResult && hpResult.data) {
            var data = hpResult.data;
            var type = hpResult.type || (hpResult.text ? EX.detectDocType(hpResult.text) : 'invoice');
            var newName = FN.genAnyFilename(data, type, file.name);
            newName = ensureUniqueName(newName, globalIdx);
            results.push({ file: file, data: data, type: type, newName: newName, text: hpResult.text || '' });
            addRow(globalIdx, file.name, newName, type, data);
            updateStats();
            resolve();
          } else {
            doFrontend(); // 降级
          }
        }).catch(function() {
          doFrontend(); // 降级到前端
        });
      } else {
        doFrontend();
      }
    });
  }

  /* ========= 去重文件名 ========= */

  function ensureUniqueName(name, idx) {
    if (!nameSet[name]) {
      nameSet[name] = true;
      return name;
    }
    var dot = name.lastIndexOf('.');
    var base = dot > 0 ? name.substring(0, dot) : name;
    var ext  = dot > 0 ? name.substring(dot) : '';
    var n = 2, candidate;
    do {
      candidate = base + '_' + n + ext;
      n++;
    } while (nameSet[candidate]);
    nameSet[candidate] = true;
    return candidate;
  }

  /* ========= 表格操作 ========= */

  function clearTable() {
    var tbody = document.getElementById('resultBody');
    if (tbody) tbody.innerHTML = '';
    results = [];
    nameSet = {};
    updateStats();
  }

  function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.substring(0, n) + '…' : s;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function addRow(index, orig, renamed, type, data) {
    var tbody = document.getElementById('resultBody');
    if (!tbody) return;

    // 清除空状态行
    var emptyRow = tbody.querySelector('.empty-state');
    if (emptyRow && emptyRow.parentElement) {
      tbody.innerHTML = '';
    }

    var typeLabel = { invoice: '🧾 发票', train: '🚄 火车票', contract: '📋 合同', error: '⚠️ 失败' };
    var typeClass = { invoice: 'type-invoice', train: 'type-train', contract: 'type-contract', error: 'type-error' };

    var isError = type === 'error';
    var displayName = isError
      ? '<span class="error">' + renamed + '</span>'
      : '<span class="editable" onclick="APP_editRow(' + index + ')" title="点击编辑">' + renamed + '</span>';

    var dateVal = (data && (data.date || data.sign_date)) || '';
    var amtVal = '';
    if (data) {
      if (data.amount)   amtVal = data.amount;
      else if (data.price) amtVal = data.price;
    }

    var tr = document.createElement('tr');
    tr.dataset.index = index;
    tr.innerHTML =
      '<td title="' + escapeHtml(orig) + '">' + truncate(orig, 40) + '</td>' +
      '<td>' + displayName + '</td>' +
      '<td><span class="type-tag ' + (typeClass[type] || '') + '">' + (typeLabel[type] || type) + '</span></td>' +
      '<td>' + dateVal + '</td>' +
      '<td>' + amtVal + '</td>' +
      '<td><button class="btn-small" onclick="APP_removeRow(' + index + ')">删除</button></td>';

    tbody.appendChild(tr);
  }

  // 全局暴露（供 onclick 调用）
  global.APP_editRow = function(index) {
    currentEditIndex = index;
    var item = results[index];
    if (!item || item.type === 'error') return;

    var elOrig = document.getElementById('editOrig');
    var elNew  = document.getElementById('editNew');
    var elDate = document.getElementById('editDate');
    var elAmt  = document.getElementById('editAmount');
    var elByr  = document.getElementById('editBuyer');
    var elSup  = document.getElementById('editSupplier');

    if (elOrig) elOrig.value = (item.file && item.file.name) || '';
    if (elNew)  elNew.value  = item.newName || '';
    if (elDate) elDate.value = (item.data && (item.data.date || item.data.sign_date)) || '';
    if (elAmt)  elAmt.value  = (item.data && (item.data.amount || item.data.price)) || '';
    if (elByr)  elByr.value  = (item.data && (item.data.buyer || item.data.party_a)) || '';
    if (elSup)  elSup.value  = (item.data && (item.data.supplier || item.data.party_b)) || '';

    var modal = document.getElementById('editModal');
    if (modal) modal.classList.remove('hidden');
  };

  global.APP_saveEdit = function() {
    var item = results[currentEditIndex];
    if (!item) return;

    var oldName = item.newName;

    var elDate = document.getElementById('editDate');
    var elAmt  = document.getElementById('editAmount');
    var elByr  = document.getElementById('editBuyer');
    var elSup  = document.getElementById('editSupplier');

    // 更新字段
    if (item.type === 'invoice') {
      if (elByr) item.data.buyer    = elByr.value.trim();
      if (elSup) item.data.supplier = elSup.value.trim();
      if (elAmt) item.data.amount   = elAmt.value.trim();
    } else if (item.type === 'contract') {
      if (elByr) item.data.party_a = elByr.value.trim();
      if (elSup) item.data.party_b = elSup.value.trim();
      if (elAmt) item.data.amount  = elAmt.value.trim();
    } else if (item.type === 'train') {
      if (elAmt) item.data.price = elAmt.value.trim();
    }

    // 重新生成文件名
    item.newName = FN.genAnyFilename(item.data, item.type, item.file.name);

    // 更新 nameSet
    delete nameSet[oldName];
    item.newName = ensureUniqueName(item.newName, currentEditIndex);

    // 更新表格
    var editableSpan = document.querySelector('tr[data-index="' + currentEditIndex + '"] .editable');
    if (editableSpan) editableSpan.textContent = item.newName;
    var elNew2 = document.getElementById('editNew');
    if (elNew2) elNew2.value = item.newName;

    APP_closeEdit();
    toast('已更新 ✅');
  };

  global.APP_closeEdit = function() {
    var modal = document.getElementById('editModal');
    if (modal) modal.classList.add('hidden');
    currentEditIndex = -1;
  };

  global.APP_removeRow = function(index) {
    var item = results[index];
    if (!item) return;
    delete nameSet[item.newName];
    results.splice(index, 1);
    rebuildTable();
  };

  function rebuildTable() {
    var tbody = document.getElementById('resultBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    nameSet = {};

    if (!results.length) {
      tbody.innerHTML =
        '<tr><td colspan="6">' +
          '<div class="empty-state">' +
            '<span class="empty-icon">📄</span>' +
            '<p>还没有文件，请拖拽或选择文件开始识别</p>' +
          '</div>' +
        '</td></tr>';
      updateStats();
      return;
    }

    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      r.newName = ensureUniqueName(r.newName, i);
      var typeLabel = { invoice: '🧾 发票', train: '🚄 火车票', contract: '📋 合同', error: '⚠️ 失败' };
      var typeClass = { invoice: 'type-invoice', train: 'type-train', contract: 'type-contract', error: 'type-error' };
      var isError = r.type === 'error';
      var displayName = isError
        ? '<span class="error">' + r.newName + '</span>'
        : '<span class="editable" onclick="APP_editRow(' + i + ')" title="点击编辑">' + r.newName + '</span>';
      var dateVal = (r.data && (r.data.date || r.data.sign_date)) || '';
      var amtVal  = (r.data && (r.data.amount || r.data.price)) || '';

      var tr = document.createElement('tr');
      tr.dataset.index = i;
      tr.innerHTML =
        '<td title="' + escapeHtml(r.file.name) + '">' + truncate(r.file.name, 40) + '</td>' +
        '<td>' + displayName + '</td>' +
        '<td><span class="type-tag ' + (typeClass[r.type] || '') + '">' + (typeLabel[r.type] || r.type) + '</span></td>' +
        '<td>' + dateVal + '</td>' +
        '<td>' + amtVal + '</td>' +
        '<td><button class="btn-small" onclick="APP_removeRow(' + i + ')">删除</button></td>';
      tbody.appendChild(tr);
    }
    updateStats();
  }

  /* ========= 进度条 ========= */

  function updateProgress(current, total, name) {
    var bar = document.getElementById('progress');
    if (!bar) return;
    bar.classList.remove('hidden');
    bar.innerHTML = '<span class="loading-spinner"></span> (' + current + '/' + total + ') 正在识别: ' + truncate(name, 30);
  }

  function hideProgress() {
    var bar = document.getElementById('progress');
    if (bar) bar.classList.add('hidden');
  }

  function updateFileHint(text) {
    var hint = document.getElementById('fileHint');
    if (hint) hint.textContent = text;
  }

  /* ========= 统计 ========= */

  function updateStats() {
    var bar = document.getElementById('statsBar');
    if (!bar) return;
    bar.style.display = results.length ? 'flex' : 'none';

    var inv = 0, tr = 0, ct = 0, err = 0;
    for (var i = 0; i < results.length; i++) {
      if (results[i].type === 'invoice') inv++;
      else if (results[i].type === 'train') tr++;
      else if (results[i].type === 'contract') ct++;
      else err++;
    }

    var elInv = document.getElementById('statInvoice');
    var elTr  = document.getElementById('statTrain');
    var elCt  = document.getElementById('statContract');
    var elErr = document.getElementById('statError');
    if (elInv) elInv.textContent = inv;
    if (elTr)  elTr.textContent  = tr;
    if (elCt)  elCt.textContent  = ct;
    if (elErr) elErr.textContent = err;
  }

  /* ========= 按钮绑定 ========= */

  function bindButtons() {
    var btnZip = document.getElementById('downloadZip');
    if (btnZip) btnZip.addEventListener('click', function() {
      if (!results.length) return toast('没有可导出的文件');
      EXPORT.downloadZip(results);
    });

    var btnCsv = document.getElementById('downloadCsv');
    if (btnCsv) btnCsv.addEventListener('click', function() {
      if (!results.length) return toast('没有可导出的文件');
      EXPORT.downloadCsv(results);
    });

    var btnXls = document.getElementById('downloadExcel');
    if (btnXls) btnXls.addEventListener('click', function() {
      if (!results.length) return toast('没有可导出的文件');
      EXPORT.downloadExcel(results);
    });
  }

  /* ========= Toast ========= */

  function toast(msg) {
    var t = document.getElementById('toast');
    if (!t) { console.log(msg); return; }
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function() { t.classList.add('hidden'); }, 2500);
  }

  /* ========= 编辑弹窗：点击背景关闭 ========= */

  var modal = document.getElementById('editModal');
  if (modal) {
    modal.addEventListener('click', function(e) {
      if (e.target === modal) APP_closeEdit();
    });
  }

  /* ========= 暴露到全局 ========= */

  global.APP = {
    editRow:    APP_editRow,
    saveEdit:   APP_saveEdit,
    closeEdit:  APP_closeEdit,
    removeRow:  APP_removeRow,
    toast:       toast,
    clearTable:  clearTable
  };

  // 兼容旧名（onclick 属性中的函数名）
  global.FN_editRow    = APP_editRow;
  global.FN_saveEdit   = APP_saveEdit;
  global.FN_closeEdit  = APP_closeEdit;
  global.FN_removeRow  = APP_removeRow;
  global.toast         = toast;

})(window);
