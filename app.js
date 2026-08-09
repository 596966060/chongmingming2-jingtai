/* ============================================================
   app.js —— 主控制逻辑（修复版）
   修复：类型判断fallback、docx支持、拖拽增强
   ============================================================ */

// ---------- 工具 ----------
function getExt(filename) {
  const m = String(filename).match(/\.[^.]+$/);
  return m ? m[0].toLowerCase() : '.pdf';
}

// 从文件名补充字段（增强版）
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

  // 支持 "6.8" 或 "6-8" 格式
  const md = s.match(/(?:^|[\s\-_.])(\d{1,2})[.\-](\d{1,2})(?:$|[\s\-_.])/);
  if (md && !result.date) {
    const mo = +md[1], d = +md[2];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const year = new Date().getFullYear();
      result.date = `${year}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
  }

  // 支持 "2025-06-08" 或 "2025/06/08"
  const m2 = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m2 && !result.date) {
    const y = +m2[1], mo = +m2[2], d = +m2[3];
    if (y >= 2000 && y <= 2030 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      result.date = `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
  }

  // 发票号（15-25位数字）
  const inv = s.match(/\b(\d{15,25})\b/);
  if (inv) result.invoice_number = inv[1];

  // 提取路线模式：城市-城市（如 "沈阳-上海"）
  const routeMatch = s.match(/([\u4e00-\u9fa5]{2,6})\s*[-—–~]\s*([\u4e00-\u9fa5]{2,6})/);
  if (routeMatch) {
    const from = routeMatch[1], to = routeMatch[2];
    const skipWords = /^(发票|报销|凭证|订单|机票|行程单|合同|协议|原件|复印件|电子|住宿)/;
    if (!skipWords.test(from) && !skipWords.test(to)) {
      result.from_station = from;
      result.to_station = to;
    }
  }

  // 提取中文片段（公司名 / 地点 / 甲方乙方）
  const STOP = new Set(['住宿费','发票','火车票','飞机票','打车票','合同','机票','报销','凭证','电子发票','电子','订单','原件','复印件','扫描件','住宿','行程单']);
  const cn = s.split(/[_\-\s\.]+/).filter(p => /^[\u4e00-\u9fa5]{2,20}$/.test(p) && !STOP.has(p));
  if (cn.length) {
    cn.sort((a,b) => b.length - a.length);
    result.buyer = cn[0];
    result.supplier = (cn.length >= 2 && cn[1] !== cn[0]) ? cn[1] : '';
    const place = cn.find(p => /站|路|酒店|宾馆|机场|高铁/.test(p));
    if (place) result.place = place;
  }

  // 尝试从文件名提取合同名称（"XXX合同"、"XXX协议"）
  const contractMatch = s.match(/([\u4e00-\u9fa5\w]{2,20})\s*(?:合同|协议|合同原件|协议原件)/);
  if (contractMatch) result.contract_name = contractMatch[1];

  return result;
}

// 从文件名猜测类型
function guessTypeFromName(name) {
  const n = String(name).toLowerCase();
  if (/飞机票|航班|机票|行程单|flight|air|飞猪|携程.*机票|登机牌/.test(n)) return '飞机票';
  if (/火车票|高铁|动车|列车|g\d+|d\d+|t\d+|k\d+|12306/.test(n)) return '火车票';
  if (/T3出行|滴滴|曹操|高德打车|美团打车|打车|网约车|出租车/.test(n)) return '打车票';
  if (/住宿|宾馆|酒店|旅店|如家|汉庭|全季|民宿/.test(n)) return '住宿费';
  if (/合同|协议|甲方|乙方|采购合同|服务合同/.test(n)) return '合同';
  return '发票';
}

// ---------- 文件处理主流程 ----------
async function handleFiles(files) {
  const fileArray = Array.from(files).filter(f =>
    /\.(pdf|jpg|jpeg|png|bmp|docx|doc)$/i.test(f.name)
  );

  if (!fileArray.length) {
    toast('请选择支持的文件（PDF、图片、DOCX/DOC）');
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

      // 如果 OCR 文本为空或极短，视为完全失败，完全走文件名兜底
      const textLen = (data._raw_text || '').length;
      console.log(`[${file.name}] OCR 文本长度: ${textLen}`);
      if (textLen < 30) {
        console.warn('OCR 文本过短，完全依赖文件名补充');
        const stem = file.name.replace(/\.[^.]+$/, '');
        const fnFields = extractFromFilename(stem);
        // 优先用文件名判断的类型（避免 OCR 误判类型）
        const guessedType = guessTypeFromName(file.name);

        // 如果 OCR 有一点文字但不足以提取字段，仍尝试从 OCR 文本获取部分信息
        if (textLen >= 10 && data) {
          // OCR 有些文字，尝试提取基础字段
          const ocrFields = (data._raw_text || '').length >= 10 ? window.EX.extractInvoiceFields(data._raw_text || '', stem) : {};
          for (const k of ['date','amount','buyer','supplier','from_station','to_station','place','sign_date','contract_name','party_a','party_b']) {
            if (ocrFields[k] && !fnFields[k]) fnFields[k] = ocrFields[k];
          }
          // 类型仍用 OCR 结果（如果比文件名更有信息量）
          const ocrType = window.FN.docType(data._raw_text || '');
          const finalType = (ocrType !== '发票') ? ocrType : guessedType;
          const finalData = {
            date: fnFields.date || data.date || '',
            supplier: fnFields.supplier || data.supplier || '',
            buyer: fnFields.buyer || data.buyer || '',
            amount: fnFields.amount || data.amount || '',
            from_station: fnFields.from_station || data.from_station || '',
            to_station: fnFields.to_station || data.to_station || '',
            place: fnFields.place || data.place || '',
            sign_date: fnFields.sign_date || data.sign_date || fnFields.date || '',
            contract_name: fnFields.contract_name || data.contract_name || '',
            party_a: fnFields.party_a || data.party_a || fnFields.buyer || '',
            party_b: fnFields.party_b || data.party_b || fnFields.supplier || '',
            _raw_text: data._raw_text || '',
          };
          // 防止 buyer 和 supplier 重复
          if (finalData.buyer && finalData.supplier && finalData.buyer === finalData.supplier) {
            finalData.supplier = '';
          }
          const newName = FN.generateFilename(finalData, finalType, getExt(file.name));
          // 如果 generateFilename 返回 __FALLBACK__ 标记，说明生成的文件名无意义，用原文件名
          let finalName;
          if (newName.startsWith('__FALLBACK__')) {
            finalName = file.name;
          } else {
            finalName = newName;
          }
          results.push({ file, data: finalData, type: finalType, newName: finalName });
          addRow(i, file.name, finalName, finalType, finalData);
          continue;
        }

        const fallbackData = {
          date: fnFields.date || '',
          supplier: fnFields.supplier || '',
          buyer: fnFields.buyer || '',
          amount: '',
          from_station: fnFields.from_station || '',
          to_station: fnFields.to_station || '',
          place: fnFields.place || '',
          sign_date: fnFields.sign_date || fnFields.date || '',
          contract_name: fnFields.contract_name || '',
          party_a: fnFields.buyer || '',
          party_b: fnFields.supplier || '',
          _raw_text: '',
        };
        // 防止 buyer 和 supplier 重复
        if (fallbackData.buyer && fallbackData.supplier && fallbackData.buyer === fallbackData.supplier) {
          fallbackData.supplier = '';
        }
        const newName = FN.generateFilename(fallbackData, guessedType, getExt(file.name));
        let finalName2;
        if (newName.startsWith('__FALLBACK__')) {
          finalName2 = file.name;
        } else {
          finalName2 = newName;
        }
        results.push({ file, data: fallbackData, type: guessedType, newName: finalName2 });
        addRow(i, file.name, finalName2, guessedType, fallbackData);
        continue;
      }

      // 从文件名补充缺失字段
      const fnFields = extractFromFilename(file.name.replace(/\.[^.]+$/, ''));
      for (const k of ['date','invoice_number','buyer','supplier','sign_date','party_a','party_b','place','from_station','to_station']) {
        if (!data[k] && fnFields[k]) data[k] = fnFields[k];
      }

      // 确定文档类型
      let docType = window.FN.docType(data._raw_text || '');
      // 若 OCR 检测类型为发票但文件名明显是其他，则覆盖
      const guessed = guessTypeFromName(file.name);
      if (docType === '发票' && guessed !== '发票') {
        docType = guessed;
      }
      // 如果 OCR 类型是火车票但文件名是飞机票，也覆盖
      if ((docType === '火车票' && guessed === '飞机票') ||
          (docType === '飞机票' && guessed === '火车票')) {
        docType = guessed;
      }
      // T3出行优先于火车票
      if (docType === '火车票' && /T3出行|滴滴|曹操|网约车|打车/.test(file.name.toLowerCase())) {
        docType = '打车票';
      }

      const newName = FN.generateFilename(data, docType, getExt(file.name));
      let finalNewName;
      if (newName.startsWith('__FALLBACK__')) {
        finalNewName = file.name;
      } else {
        finalNewName = newName;
      }

      results.push({ file, data, type: docType, newName: finalNewName });
      addRow(i, file.name, finalNewName, docType, data);

    } catch (err) {
      console.error('处理文件异常:', err);
      const stem = file.name.replace(/\.[^.]+$/, '');
      const fnFields = extractFromFilename(stem);
      const guessedType = guessTypeFromName(file.name);
      const fallbackData = {
        date: fnFields.date || '',
        supplier: fnFields.supplier || '',
        buyer: fnFields.buyer || '',
        amount: '',
        from_station: fnFields.from_station || '',
        to_station: fnFields.to_station || '',
        place: fnFields.place || '',
        sign_date: fnFields.sign_date || fnFields.date || '',
        contract_name: fnFields.contract_name || '',
        party_a: fnFields.buyer || '',
        party_b: fnFields.supplier || '',
        _raw_text: '',
      };
      if (fallbackData.buyer && fallbackData.supplier && fallbackData.buyer === fallbackData.supplier) {
        fallbackData.supplier = '';
      }
      const newName = FN.generateFilename(fallbackData, guessedType, getExt(file.name));
      let finalName;
      if (newName.startsWith('__FALLBACK__')) {
        finalName = file.name;
      } else {
        finalName = newName;
      }
      results.push({ file, data: fallbackData, type: guessedType, newName: finalName });
      addRow(i, file.name, finalName, guessedType, fallbackData);
    }
  }

  hideProgress();
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

  const pickBtn = document.getElementById('pickFileBtn');
  const fileInput = document.getElementById('fileInput');

  dropZone.addEventListener('click', (e) => {
    if (e.target === pickBtn || pickBtn.contains(e.target)) return;
    fileInput.click();
  });

  if (pickBtn) {
    pickBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
  }

  // 拖拽：用 relatedTarget 防止子元素冒泡导致闪烁
  let dragCounter = 0;
  dropZone.addEventListener('dragenter', e => {
    e.preventDefault();
    dragCounter++;
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  dropZone.addEventListener('dragleave', e => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dropZone.classList.remove('drag-over');
    }
  });

  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    dropZone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files && files.length) {
      handleFiles(files);
    }
  });
}

function bindButtons() {
  document.getElementById('downloadZip')?.addEventListener('click', () => window.EXPORT.downloadZip(results));
  document.getElementById('downloadCsv')?.addEventListener('click', () => window.EXPORT.downloadCsv(results));
  document.getElementById('downloadExcel')?.addEventListener('click', () => window.EXPORT.downloadExcel(results));
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
    <td><button class="btn-small" onclick="deleteRow(${index})">删除</button></td>
  `;
  document.querySelector('#resultTable tbody').appendChild(tr);
}

// 删除行
window.deleteRow = function(index) {
  results.splice(index, 1);
  // 重新渲染表格
  clearTable();
  results.forEach((item, i) => {
    addRow(i, item.file.name, item.newName, item.type, item.data);
  });
};

// ---------- 编辑 ----------
window.editRow = function (index) {
  currentEditIndex = index;
  const item = results[index];
  if (!item || item.type === 'error') return;

  document.getElementById('editOrig').value = item.file.name;
  document.getElementById('editNew').value = item.newName;
  document.getElementById('editDate').value = item.data.date || item.data.sign_date || '';
  document.getElementById('editAmount').value = item.data.amount || '';
  document.getElementById('editBuyer').value = item.data.buyer || item.data.party_a || '';
  document.getElementById('editSupplier').value = item.data.supplier || item.data.party_b || '';
  document.getElementById('editPlace').value = item.data.place || item.data.from_station || '';

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
  item.data.party_a = document.getElementById('editBuyer').value;
  item.data.party_b = document.getElementById('editSupplier').value;

  const docType = item.type;
  item.newName = FN.generateFilename(item.data, docType, getExt(item.file.name));
  // 如果生成结果带 FALLBACK 标记，说明字段不足以生成有意义文件名
  if (item.newName.startsWith('__FALLBACK__')) {
    item.newName = item.file.name; // 保持原文件名
  }

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
