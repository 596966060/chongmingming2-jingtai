/* ============================================================
   app.js —— v4 主控制逻辑
   核心原则：OCR 失败也用文件名生成名称，绝不默认保留原名
   ============================================================ */

// ---------- 工具 ----------
function getExt(filename) {
  const m = String(filename).match(/\.[^.]+$/);
  return m ? m[0].toLowerCase() : '.pdf';
}

// 从文件名补充字段（增强版 v4）
function extractFromFilename(stem) {
  const result = {};
  const s = String(stem || '');

  // 8 位日期 20250608
  const m = s.match(/20(\d{2})(\d{2})(\d{2})/);
  if (m) {
    const y = 2000 + (+m[1]), mo = +m[2], d = +m[3];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      result.date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // "6.8" 或 "6-8" 格式
  if (!result.date) {
    const md = s.match(/(?:^|[\s\-_.（(【《])(\d{1,2})[.\-](\d{1,2})(?:$|[\s\-_.）)】》])/);
    if (md) {
      const mo = +md[1], d = +md[2];
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        const year = new Date().getFullYear();
        result.date = `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
  }

  // "2025-06-08" 格式
  if (!result.date) {
    const m2 = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m2) {
      const y = +m2[1], mo = +m2[2], d = +m2[3];
      if (y >= 2000 && y <= 2030 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        result.date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
  }

  // 飞猪订单号中提取日期（14位订单号包含日期）
  if (!result.date) {
    const orderDate = s.match(/订单[号]?(\d{14})/);
    if (orderDate) {
      const od = orderDate[1];
      const y = +od.substring(0, 4), mo = +od.substring(4, 6), d = +od.substring(6, 8);
      if (y >= 2000 && y <= 2030 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        result.date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
  }

  // 发票号
  const inv = s.match(/\b(\d{15,25})\b/);
  if (inv) result.invoice_number = inv[1];

  // 金额提取（从文件名中的数字）
  const amtMatch = s.match(/[¥￥]?\s*(\d{1,6}(?:\.\d{1,2})?)\s*元/);
  if (amtMatch) {
    result.amount = parseFloat(amtMatch[1]).toFixed(2);
  }

  // 路线模式："沈阳-上海"
  const routeMatch = s.match(/([\u4e00-\u9fa5]{2,6})\s*[-—–~]\s*([\u4e00-\u9fa5]{2,6})/);
  if (routeMatch) {
    const from = routeMatch[1], to = routeMatch[2];
    const skipWords = /^(发票|报销|凭证|订单|机票|行程单|合同|协议|原件|复印件|电子|住宿|打车|飞猪|携程)$/;
    if (!skipWords.test(from) && !skipWords.test(to)) {
      result.from_station = from;
      result.to_station = to;
    }
  }

  // 中文片段（公司名 / 地点）
  const STOP = new Set(['住宿费', '发票', '火车票', '飞机票', '打车票', '合同', '机票', '报销', '凭证',
    '电子发票', '电子', '订单', '原件', '复印件', '扫描件', '住宿', '行程单', '打车',
    '出行', '网约车', '出租车', '高铁', '动车', '协议', '甲方', '乙方', '飞猪', '携程']);
  const cn = s.split(/[_\-\s\.（(【《）)】》]+/).filter(p => /^[\u4e00-\u9fa5]{2,20}$/.test(p) && !STOP.has(p));
  if (cn.length) {
    cn.sort((a, b) => b.length - a.length);
    // 判断是否有地点关键词
    const placeIdx = cn.findIndex(p => /站|路|酒店|宾馆|机场|高铁|广德|德县|城市/.test(p));
    if (placeIdx !== -1) {
      result.place = cn[placeIdx];
      // 剩余的非地点片段作为 buyer/supplier
      const remaining = cn.filter((_, i) => i !== placeIdx);
      if (remaining.length > 0 && !result.buyer) result.buyer = remaining[0];
      if (remaining.length > 1 && !result.supplier && remaining[1] !== remaining[0]) result.supplier = remaining[1];
    } else {
      result.buyer = cn[0];
      result.supplier = (cn.length >= 2 && cn[1] !== cn[0]) ? cn[1] : '';
    }
  }

  // 合同名称（去掉"合同原件(1)"等后缀，只取核心名称）
  const contractMatch = s.match(/([\u4e00-\u9fa5\w]{2,20})\s*(?:合同原件|协议原件|合同|协议)/);
  if (contractMatch) {
    let cn2 = contractMatch[1].trim();
    // 去掉 (1) (2) 等编号
    cn2 = cn2.replace(/\s*\(\d+\)\s*$/, '').trim();
    result.contract_name = cn2;
  }

  // 防止 buyer == supplier
  if (result.buyer && result.supplier && result.buyer === result.supplier) {
    result.supplier = '';
  }

  return result;
}

// 从文件名猜测类型
function guessTypeFromName(name) {
  const n = String(name).toLowerCase();
  if (/飞机票|航班|机票|行程单|flight|air|飞猪|携程.*机票|登机牌|航空/.test(n)) return '飞机票';
  if (/T3出行|滴滴|曹操|高德打车|美团打车|打车|网约车|出租车/.test(n)) return '打车票';
  if (/火车票|高铁|动车|列车|g\d{1,4}\b|d\d{1,4}\b|t\d{1,4}\b|k\d{1,4}\b|12306|车次/.test(n)) return '火车票';
  if (/住宿|宾馆|酒店|旅店|如家|汉庭|全季|民宿/.test(n)) return '住宿费';
  if (/合同|协议|甲方|乙方|采购合同|服务合同|工程合同/.test(n)) return '合同';
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
      const { data, type: ocrType } = await extractFromFile(file);
      const textLen = (data._raw_text || '').length;
      console.log(`[${file.name}] OCR 文本长度: ${textLen}, OCR类型: ${ocrType}`);

      // 从文件名提取字段
      const stem = file.name.replace(/\.[^.]+$/, '');
      const fnFields = extractFromFilename(stem);
      const fnType = guessTypeFromName(file.name);

      // 合并数据：OCR 结果 + 文件名补充
      const mergedData = Object.assign({}, data);

      // 补充文件名中的字段（OCR没提取到的才补）
      const fillKeys = ['date', 'invoice_number', 'buyer', 'supplier',
        'from_station', 'to_station', 'place', 'sign_date', 'contract_name',
        'party_a', 'party_b', 'amount'];
      for (const k of fillKeys) {
        if (!mergedData[k] && fnFields[k]) mergedData[k] = fnFields[k];
      }

      // 飞猪/携程订单号中提取日期（如果上面都没提取到）
      if (!mergedData.date) {
        const orderNum = stem.match(/订单[号]?\s*(\d{12,14})/);
        if (orderNum) {
          const od = orderNum[1];
          // 尝试多种日期编码方式
          const tries = [
            () => { const y=2000+ +od.substring(0,2), mo=+od.substring(2,4), d=+od.substring(4,6); return (y>=2020&&y<=2030&&mo>=1&&mo<=12&&d>=1&&d<=31)?`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`:null; },
            () => { const y=+od.substring(0,4), mo=+od.substring(4,6), d=+od.substring(6,8); return (y>=2020&&y<=2030&&mo>=1&&mo<=12&&d>=1&&d<=31)?`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`:null; }
          ];
          for (const tryFn of tries) {
            const r = tryFn();
            if (r) { mergedData.date = r; break; }
          }
        }
      }

      // 如果 OCR 有 amount 但格式不标准，优先用 OCR 的
      if (!data.amount && fnFields.amount) mergedData.amount = fnFields.amount;

      // 类型决策逻辑
      let docType = ocrType;

      // OCR 文本太短时，完全信任文件名判断的类型
      if (textLen < 30) {
        docType = fnType;
      }

      // 文件名类型覆盖规则
      if (docType === '发票' && fnType !== '发票') {
        docType = fnType;
      }

      // T3出行/打车保护：文件名含打车关键词 → 强制打车票（任何情况都不例外）
      if (/T3出行|T3|滴滴|曹操|高德打车|美团打车|网约车|打车|出租车/i.test(file.name)) {
        docType = '打车票';
      }

      // 飞机票 vs 火车票冲突时，文件名优先
      if ((docType === '火车票' && fnType === '飞机票') ||
          (docType === '飞机票' && fnType === '火车票')) {
        docType = fnType;
      }

      // 合同：如果 OCR 没提取到甲乙方，用文件名的 buyer/supplier
      if (docType === '合同') {
        if (!mergedData.party_a && mergedData.buyer) mergedData.party_a = mergedData.buyer;
        if (!mergedData.party_b && mergedData.supplier) mergedData.party_b = mergedData.supplier;
        // 合同不需要 buyer/supplier 字段，清空避免混淆
        delete mergedData.buyer;
        delete mergedData.supplier;
      }

      // 交通票：确保 from/to 存在
      if ((docType === '飞机票' || docType === '火车票' || docType === '打车票')) {
        if (!mergedData.from_station && fnFields.from_station) {
          mergedData.from_station = fnFields.from_station;
        }
        if (!mergedData.to_station && fnFields.to_station) {
          mergedData.to_station = fnFields.to_station;
        }
      }

      // 确保 buyer != supplier
      if (mergedData.buyer && mergedData.supplier && mergedData.buyer === mergedData.supplier) {
        mergedData.supplier = '';
      }
      if (mergedData.party_a && mergedData.party_b && mergedData.party_a === mergedData.party_b) {
        mergedData.party_b = '';
      }

      // 生成新文件名
      const newName = FN.generateFilename(mergedData, docType, getExt(file.name));
      let finalName;
      if (newName.startsWith('__FALLBACK__')) {
        // 只有极端情况下（完全无数据）才保留原名
        finalName = file.name;
        console.warn(`[${file.name}] 所有引擎均无法提取有效信息，保留原文件名`);
      } else {
        finalName = newName;
      }

      results.push({ file, data: mergedData, type: docType, newName: finalName });
      addRow(i, file.name, finalName, docType, mergedData);

    } catch (err) {
      console.error('处理文件异常:', err);
      const stem = file.name.replace(/\.[^.]+$/, '');
      const fnFields = extractFromFilename(stem);
      const guessedType = guessTypeFromName(file.name);
      const fallbackData = Object.assign({}, fnFields);

      if (guessedType === '合同') {
        fallbackData.party_a = fnFields.buyer || '';
        fallbackData.party_b = fnFields.supplier || '';
        delete fallbackData.buyer;
        delete fallbackData.supplier;
      }

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

  // 拖拽
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
  const tbody = document.querySelector('#resultTable tbody');
  if (tbody) tbody.innerHTML = '';
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
  if (item.newName.startsWith('__FALLBACK__')) {
    item.newName = item.file.name;
  }

  const row = document.querySelector(`tr[data-index="${currentEditIndex}"] .editable`);
  if (row) row.textContent = item.newName;
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
