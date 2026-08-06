/* ============================================================
   app.js —— 主控制逻辑（严格对齐 filenames.js 三条命名规则）
   ============================================================ */

// ---------- 工具 ----------
function getExt(filename) {
  const m = String(filename).match(/\.[^.]+$/);
  return m ? m[0].toLowerCase() : '.pdf';
}

// 从文件名补充字段（日期 / 公司名线索）
function extractFromFilename(stem) {
  const result = {};
  const s = String(stem || '');

  // 8 位日期 20250608
  const m = s.match(/20(\d{2})(\d{2})(\d{2})/);
  if (m) {
    const y = 2000 + (+m[1]), mo = +m[2], d = +m[3];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      result.date = `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
  }

  // 15-25 位发票号
  const inv = s.match(/\b(\d{15,25})\b/);
  if (inv) result.invoice_number = inv[1];

  // 中文片段（公司名 / 地点）
  const cn = s.split(/[_\-\s\.]+/).filter(p => /^[\u4e00-\u9fa5]{2,20}$/.test(p));
  const STOP = new Set(['住宿费','发票','火车票','飞机票','打车票','合同','机票','报销','凭证']);
  const cand = cn.filter(p => !STOP.has(p));
  if (cand.length) {
    cand.sort((a,b) => b.length - a.length);
    result.buyer = cand[0];
    result.supplier = cand[0];
  }
  return result;
}

// ---------- 文件处理主流程 ----------
async function handleFiles(files) {
  const fileArray = Array.from(files).filter(f =>
    /\.(pdf|jpg|jpeg|png|bmp|docx)$/i.test(f.name)
  );

  if (!fileArray.length) {
    toast('请选择支持的发票 / 火车票 / 合同文件');
    return;
  }

  results = [];
  clearTable();

  for (let i = 0; i < fileArray.length; i++) {
    const file = fileArray[i];
    updateProgress(i + 1, fileArray.length, file.name);

    try {
      // OCR 识别
      const { data, type } = await extractFromFile(file);

      // 从文件名补充缺失字段
      const fnFields = extractFromFilename(file.name.replace(/\.[^.]+$/, ''));
      for (const k of ['date','invoice_number','buyer','supplier','sign_date','party_a','party_b']) {
        if (!data[k] && fnFields[k]) data[k] = fnFields[k];
      }

      // ✅ 统一命名（调用 filenames.js）
      const docType = window.docType ? window.docType(data._raw_text) : type;
      const newName = FN.generateFilename(data, docType, getExt(file.name));

      results.push({ file, data, type: docType, newName });
      addRow(i, file.name, newName, docType, data);

    } catch (err) {
      // ✅ OCR 完全失败时：兜底命名
      const fnFields = extractFromFilename(file.name.replace(/\.[^.]+$/, ''));
      const fallbackData = {
        date: fnFields.date || '',
        supplier: fnFields.supplier || fnFields.buyer || '',
        buyer: fnFields.buyer || fnFields.supplier || '',
        amount: '',
        from_station: '',
        to_station: '',
        place: '',
        sign_date: '',
        contract_name: '',
        party_a: '',
        party_b: '',
        _raw_text: '',
      };

      const guessedType = guessTypeFromName(file.name);
      const newName = FN.generateFilename(fallbackData, guessedType, getExt(file.name));

      results.push({ file, data: fallbackData, type: guessedType, newName });
      addRow(i, file.name, newName, guessedType, fallbackData);
      console.warn('OCR 失败，已兜底命名：', file.name);
    }
  }

  hideProgress();
}

// 从文件名猜测类型（兜底用）
function guessTypeFromName(name) {
  const n = String(name).toLowerCase();
  if (/飞机票|航班|机票|行程单|flight|air/.test(n)) return '飞机票';
  if (/火车票|高铁|动车|列车|g\d+|d\d+|t\d+|k\d+/.test(n)) return '火车票';
  if (/住宿|宾馆|酒店|旅店/.test(n)) return '住宿费';
  if (/打车|滴滴|出租车|网约车|车费/.test(n)) return '打车票';
  if (/合同|协议|甲方|乙方/.test(n)) return '合同';
  return '发票';
}

// ---------- DOM / 事件 ----------
let results = [];
let currentEditIndex = null;

document.addEventListener('DOMContentLoaded', () => {
  bindFileInput();
  bindDragDrop();
  bindButtons();
});

function bindFileInput() {
  const input = document.getElementById('fileInput');
  if (!input) return;
  input.addEventListener('change', e => handleFiles(e.target.files));
}

function bindDragDrop() {
  const dropZone = document.getElementById('dropZone');
  if (!dropZone) return;

  dropZone.addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });

  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
  });
}

function bindButtons() {
  document.getElementById('downloadZip')?.addEventListener('click', () => downloadZip(results));
  document.getElementById('downloadCsv')?.addEventListener('click', () => downloadCsv(results));
  document.getElementById('downloadExcel')?.addEventListener('click', () => downloadExcel(results));
}

// ---------- 表格 ----------
function clearTable() {
  document.querySelector('#resultTable tbody').innerHTML = '';
}

function addRow(index, orig, renamed, type, data) {
  const tr = document.createElement('tr');
  tr.dataset.index = index;

  const editable = type === 'error'
    ? `<span class="error">${renamed}</span>`
    : `<span class="editable" onclick="editRow(${index})">${renamed}</span>`;

  tr.innerHTML = `
    <td>${orig}</td>
    <td>${editable}</td>
    <td>${type}</td>
    <td>${data.date || data.sign_date || ''}</td>
    <td>${data.amount || ''}</td>
  `;
  document.querySelector('#resultTable tbody').appendChild(tr);
}

// ---------- 编辑 ----------
window.editRow = function (index) {
  currentEditIndex = index;
  const item = results[index];
  if (!item || item.type === 'error') return;

  document.getElementById('editOrig').value = item.file.name;
  document.getElementById('editNew').value = item.newName;
  document.getElementById('editDate').value = item.data.date || item.data.sign_date || '';
  document.getElementById('editAmount').value = item.data.amount || '';
  document.getElementById('editBuyer').value = item.data.buyer || '';
  document.getElementById('editSupplier').value = item.data.supplier || '';
  document.getElementById('editPlace').value = item.data.place || '';

  document.getElementById('editModal').classList.remove('hidden');
};

window.saveEdit = function () {
  const item = results[currentEditIndex];
  if (!item) return;

  item.data.date = document.getElementById('editDate').value;
  item.data.sign_date = document.getElementById('editDate').value;
  item.data.amount = document.getElementById('editAmount').value;
  item.data.buyer = document.getElementById('editBuyer').value;
  item.data.supplier = document.getElementById('editSupplier').value;
  item.data.place = document.getElementById('editPlace').value;

  const docType = window.docType ? window.docType(item.data._raw_text) : item.type;
  item.newName = FN.generateFilename(item.data, docType, getExt(item.file.name));

  document.querySelector(`tr[data-index="${currentEditIndex}"] .editable`).textContent = item.newName;
  closeEdit();
};

window.closeEdit = function () {
  document.getElementById('editModal').classList.add('hidden');
};

// ---------- 进度条 ----------
function updateProgress(cur, total, name) {
  const bar = document.getElementById('progress');
  if (!bar) return;
  bar.classList.remove('hidden');
  bar.textContent = `(${cur}/${total}) ${name}`;
}

function hideProgress() {
  const bar = document.getElementById('progress');
  if (bar) bar.classList.add('hidden');
}

// ---------- Toast ----------
function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 2500);
}
