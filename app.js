/**
 * app.js
 * 主控制逻辑 —— 对齐原始 app.py 的 smart_extract → 命名 → 编辑 → 导出 流程
 *
 * 流程:
 *   1. 文件选择/拖拽 → handleFiles()
 *   2. extractFromFile() → { data, type, text }
 *   3. genAnyFilename() → 新文件名
 *   4. 表格渲染 + 手动编辑 → 重新命名
 *   5. ZIP / CSV / Excel 导出
 */

import { extractFromFile, detectDocType } from './extractors.js';
import { genInvoiceName, genTrainName, genContractName, genAnyFilename } from './filenames.js';
import { downloadZip, downloadCsv, downloadExcel } from './export.js';
import { isHighPrecisionEnabled, highPrecisionExtract } from './highPrecision.js';

/* ========= 全局状态 ========= */

let results = [];          // [{ file, data, type, newName, text }]
let currentEditIndex = -1;
const nameSet = new Set();

/* ========= 初始化 ========= */

document.addEventListener('DOMContentLoaded', () => {
  initHighPrecision();
  bindFileInput();
  bindDragDrop();
  bindButtons();
});

/* ========= 文件选择 ========= */

function bindFileInput() {
  const input   = document.getElementById('fileInput');
  const pickBtn = document.getElementById('pickFileBtn');
  const dropZone = document.getElementById('dropZone');
  if (!input) return;

  // "选择文件"按钮 → 触发隐藏的 input
  if (pickBtn) {
    pickBtn.addEventListener('click', e => {
      e.stopPropagation();
      input.click();
    });
  }

  // 点击拖拽区也可以选文件
  if (dropZone) {
    dropZone.addEventListener('click', e => {
      if (e.target === input) return;
      input.click();
    });
  }

  input.addEventListener('change', e => {
    if (e.target.files && e.target.files.length) {
      handleFiles(e.target.files);
    }
    e.target.value = ''; // 允许重复选同一文件
  });
}

/* ========= 拖拽 ========= */

function bindDragDrop() {
  const dropZone = document.getElementById('dropZone');
  if (!dropZone) return;

  // 阻止浏览器默认打开文件
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
    dropZone.addEventListener(evt, e => e.preventDefault());
    document.addEventListener(evt, e => e.preventDefault());
  });

  dropZone.addEventListener('dragover', () => {
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', e => {
    if (!dropZone.contains(e.relatedTarget)) {
      dropZone.classList.remove('drag-over');
    }
  });

  dropZone.addEventListener('drop', e => {
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer && e.dataTransfer.files.length) {
      handleFiles(e.dataTransfer.files);
    }
  });
}

/* ========= 处理文件列表（核心流程） ========= */

async function handleFiles(files) {
  const fileArray = Array.from(files).filter(f =>
    /\.(pdf|jpg|jpeg|png|bmp|tiff|tif|docx|zip)$/i.test(f.name)
  );

  if (!fileArray.length) {
    toast('请选择支持的发票/火车票/合同文件（PDF、图片、DOCX）');
    return;
  }

  const startIdx = results.length;
  updateFileHint(`${fileArray.length} 个文件已加入队列`);

  for (let i = 0; i < fileArray.length; i++) {
    const file = fileArray[i];
    const globalIdx = startIdx + i;
    updateProgress(i + 1, fileArray.length, file.name);

    try {
      let data, type, text = '';

      // 1. 高精度后端（可选）
      if (isHighPrecisionEnabled()) {
        try {
          const hp = await highPrecisionExtract(file);
          if (hp && hp.data) {
            data = hp.data;
            type = hp.type || detectDocType(hp.text || '');
            text = hp.text || '';
          }
        } catch (e) { console.warn('高精度后端失败，降级前端', e); }
      }

      // 2. 前端识别（兜底或主用）
      if (!data) {
        const result = await extractFromFile(file);
        data = result.data;
        type = result.type;
        text = result.text || '';
      }

      // 3. 生成新文件名（统一入口）
      let newName = genAnyFilename(data, type, file.name);

      // 4. 去重
      newName = ensureUniqueName(newName, globalIdx);

      results.push({ file, data, type, newName, text });
      addRow(globalIdx, file.name, newName, type, data);
      updateStats();

    } catch (err) {
      console.error('处理失败:', file.name, err);
      results.push({ file, data: {}, type: 'error', newName: '识别失败', text: '' });
      addRow(globalIdx, file.name, '识别失败', 'error', {});
      updateStats();
    }
  }

  hideProgress();
  updateFileHint(`${results.length} 个文件已处理`);

  const empty = document.querySelector('.empty-state');
  if (empty) empty.parentElement.style.display = 'none';
}

/* ========= 去重文件名 ========= */

function ensureUniqueName(name, idx) {
  if (!nameSet.has(name)) {
    nameSet.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.substring(0, dot) : name;
  const ext  = dot > 0 ? name.substring(dot) : '';
  let n = 2, candidate;
  do {
    candidate = `${base}_${n}${ext}`;
    n++;
  } while (nameSet.has(candidate));
  nameSet.add(candidate);
  return candidate;
}

/* ========= 表格操作 ========= */

function clearTable() {
  const tbody = document.getElementById('resultBody');
  if (tbody) tbody.innerHTML = '';
  results = [];
  nameSet.clear();
  updateStats();
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.substring(0, n) + '…' : s;
}

function addRow(index, orig, renamed, type, data) {
  const tbody = document.getElementById('resultBody');
  if (!tbody) return;

  const emptyRow = tbody.querySelector('.empty-state');
  if (emptyRow) tbody.innerHTML = '';

  const tr = document.createElement('tr');
  tr.dataset.index = index;

  const typeLabel = { invoice: '🧾 发票', train: '🚄 火车票', contract: '📋 合同', error: '⚠️ 失败' };
  const typeClass = { invoice: 'type-invoice', train: 'type-train', contract: 'type-contract', error: 'type-error' };

  const isError = type === 'error';
  const displayName = isError
    ? `<span class="error">${renamed}</span>`
    : `<span class="editable" onclick="editRow(${index})" title="点击编辑">${renamed}</span>`;

  // 日期
  const dateVal = (data && (data.date || data.sign_date)) || '';
  // 金额
  let amtVal = '';
  if (data) {
    if (data.amount)  amtVal = data.amount;
    else if (data.price) amtVal = data.price;
  }

  tr.innerHTML = `
    <td title="${escapeHtml(orig)}">${truncate(orig, 40)}</td>
    <td>${displayName}</td>
    <td><span class="type-tag ${typeClass[type] || ''}">${typeLabel[type] || type}</span></td>
    <td>${dateVal}</td>
    <td>${amtVal}</td>
    <td><button class="btn-small" onclick="removeRow(${index})">删除</button></td>
  `;
  tbody.appendChild(tr);
}

window.removeRow = function (index) {
  const item = results[index];
  if (!item) return;
  nameSet.delete(item.newName);
  results.splice(index, 1);
  rebuildTable();
};

function rebuildTable() {
  const tbody = document.getElementById('resultBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  nameSet.clear();

  if (!results.length) {
    tbody.innerHTML = `
      <tr><td colspan="6">
        <div class="empty-state">
          <span class="empty-icon">📄</span>
          <p>还没有文件，请拖拽或选择文件开始识别</p>
        </div>
      </td></tr>`;
    updateStats();
    return;
  }

  results.forEach((r, i) => {
    r.newName = ensureUniqueName(r.newName, i);
    const typeLabel = { invoice: '🧾 发票', train: '🚄 火车票', contract: '📋 合同', error: '⚠️ 失败' };
    const typeClass = { invoice: 'type-invoice', train: 'type-train', contract: 'type-contract', error: 'type-error' };
    const isError = r.type === 'error';
    const displayName = isError
      ? `<span class="error">${r.newName}</span>`
      : `<span class="editable" onclick="editRow(${i})" title="点击编辑">${r.newName}</span>`;
    const dateVal = (r.data && (r.data.date || r.data.sign_date)) || '';
    const amtVal  = (r.data && (r.data.amount || r.data.price)) || '';

    const tr = document.createElement('tr');
    tr.dataset.index = i;
    tr.innerHTML = `
      <td title="${escapeHtml(r.file.name)}">${truncate(r.file.name, 40)}</td>
      <td>${displayName}</td>
      <td><span class="type-tag ${typeClass[r.type] || ''}">${typeLabel[r.type] || r.type}</span></td>
      <td>${dateVal}</td>
      <td>${amtVal}</td>
      <td><button class="btn-small" onclick="removeRow(${i})">删除</button></td>
    `;
    tbody.appendChild(tr);
  });
  updateStats();
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ========= 手动编辑弹窗 ========= */

window.editRow = function (index) {
  currentEditIndex = index;
  const item = results[index];
  if (!item || item.type === 'error') return;

  document.getElementById('editOrig').value    = (item.file && item.file.name) || '';
  document.getElementById('editNew').value     = item.newName || '';
  document.getElementById('editDate').value    = (item.data && (item.data.date || item.data.sign_date)) || '';
  document.getElementById('editAmount').value  = (item.data && (item.data.amount || item.data.price)) || '';
  document.getElementById('editBuyer').value   = (item.data && (item.data.buyer || item.data.party_a)) || '';
  document.getElementById('editSupplier').value = (item.data && (item.data.supplier || item.data.party_b)) || '';

  document.getElementById('editModal').classList.remove('hidden');
};

window.saveEdit = function () {
  const item = results[currentEditIndex];
  if (!item) return;

  const oldName = item.newName;

  // 更新字段（根据类型）
  if (item.type === 'invoice') {
    item.data.buyer    = document.getElementById('editBuyer').value.trim();
    item.data.supplier = document.getElementById('editSupplier').value.trim();
    item.data.amount   = document.getElementById('editAmount').value.trim();
  } else if (item.type === 'contract') {
    item.data.party_a = document.getElementById('editBuyer').value.trim();
    item.data.party_b = document.getElementById('editSupplier').value.trim();
    item.data.amount  = document.getElementById('editAmount').value.trim();
  } else if (item.type === 'train') {
    item.data.price = document.getElementById('editAmount').value.trim();
  }

  // 重新生成文件名
  item.newName = genAnyFilename(item.data, item.type, item.file.name);

  // 更新 nameSet
  nameSet.delete(oldName);
  item.newName = ensureUniqueName(item.newName, currentEditIndex);

  // 更新表格
  const editableSpan = document.querySelector(`tr[data-index="${currentEditIndex}"] .editable`);
  if (editableSpan) editableSpan.textContent = item.newName;
  document.getElementById('editNew').value = item.newName;

  closeEdit();
  toast('已更新 ✅');
};

window.closeEdit = function () {
  document.getElementById('editModal').classList.add('hidden');
  currentEditIndex = -1;
};

document.getElementById('editModal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('editModal')) closeEdit();
});

/* ========= 进度条 ========= */

function updateProgress(current, total, name) {
  const bar = document.getElementById('progress');
  if (!bar) return;
  bar.classList.remove('hidden');
  bar.innerHTML = `<span class="loading-spinner"></span> (${current}/${total}) 正在识别: ${truncate(name, 30)}`;
}

function hideProgress() {
  const bar = document.getElementById('progress');
  if (bar) bar.classList.add('hidden');
}

function updateFileHint(text) {
  const hint = document.getElementById('fileHint');
  if (hint) hint.textContent = text;
}

/* ========= 统计 ========= */

function updateStats() {
  const bar = document.getElementById('statsBar');
  if (!bar) return;
  bar.style.display = results.length ? 'flex' : 'none';

  let inv = 0, tr = 0, ct = 0, err = 0;
  results.forEach(r => {
    if (r.type === 'invoice') inv++;
    else if (r.type === 'train') tr++;
    else if (r.type === 'contract') ct++;
    else err++;
  });

  document.getElementById('statInvoice').textContent  = inv;
  document.getElementById('statTrain').textContent   = tr;
  document.getElementById('statContract').textContent = ct;
  document.getElementById('statError').textContent   = err;
}

/* ========= 按钮绑定 ========= */

function bindButtons() {
  document.getElementById('downloadZip')?.addEventListener('click', () => {
    if (!results.length) return toast('没有可导出的文件');
    downloadZip(results);
  });
  document.getElementById('downloadCsv')?.addEventListener('click', () => {
    if (!results.length) return toast('没有可导出的文件');
    downloadCsv(results);
  });
  document.getElementById('downloadExcel')?.addEventListener('click', () => {
    if (!results.length) return toast('没有可导出的文件');
    downloadExcel(results);
  });
}

/* ========= Toast ========= */

function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.add('hidden'), 2500);
}

window.toast = toast;
