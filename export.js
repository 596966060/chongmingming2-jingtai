/**
 * export.js
 * ZIP / CSV / Excel 导出 —— 对齐 Python 版 _build_csv_bytes / _build_excel_bytes
 *
 * CSV 列（23 列，与 Python 版完全一致）：
 *   原文件名, 新文件名, 状态, 类型, 日期,
 *   发票号码, 购买方, 销售方, 金额(不含税), 税额, 价税合计,
 *   车次, 出发站, 到达站, 乘客姓名, 座位, 座位类型, 票价,
 *   合同名称, 甲方, 乙方, 合同金额,
 *   错误信息
 *
 * Excel 带颜色格式（发票绿/火车票蓝/合同紫/失败黄/汇总橙）
 */

/* ========= 颜色常量（对齐 Python） ========= */

const C = {
  INV_HDR:  'FF276749',  // 深绿
  TRN_HDR:  'FF2B6CB0',  // 深蓝
  CTR_HDR:  'FF6B21A8',  // 深紫
  META_HDR: 'FF4A5568',  // 深灰
  INV_ROW:  'FFE6F4EA',  // 浅绿
  TRN_ROW:  'FFE8F0FE',  // 浅蓝
  CTR_ROW:  'FFF3E8FE',  // 浅紫
  FAIL_ROW:  'FFFFF3CD',  // 浅黄
  SUM_ROW:  'FFFFF8E1',  // 浅橙
  WHITE:    'FFFFFFFF'
};

/* ========= 工具 ========= */

function fmtAmt(v) {
  const n = parseFloat(String(v).replace(/[¥￥,，]/g, '').replace(/元$/g, ''));
  return isNaN(n) ? 0 : n;
}

function safeStr(v, max) {
  v = String(v || '').replace(/"/g, '""');
  if (max) v = v.slice(0, max);
  return v;
}

/* ========= ZIP 下载 ========= */

export function downloadZip(results) {
  if (!window.JSZip) { toast('JSZip 未加载'); return; }
  if (!results || !results.length) { toast('没有可导出的文件'); return; }

  const zip = new JSZip();
  results.forEach((r, i) => {
    if (!r || !r.file) return;
    let fname = r.newName || (r.file.name || `file_${i}`);
    fname = fname.replace(/[\\/:*?"<>|]/g, '_');
    zip.file(fname, r.file);
  });

  zip.generateAsync({ type: 'blob' }).then(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `发票_${Date.now()}.zip`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }).catch(err => { console.error('ZIP 生成失败:', err); toast('ZIP 导出失败'); });
}

/* ========= CSV 下载（带 BOM，对齐 Python） ========= */

export function downloadCsv(results) {
  if (!results || !results.length) { toast('没有可导出的文件'); return; }

  const headers = [
    '原文件名', '新文件名', '状态', '类型', '日期',
    '发票号码', '购买方', '销售方', '金额(不含税)', '税额', '价税合计',
    '车次', '出发站', '到达站', '乘客姓名', '座位', '座位类型', '票价',
    '合同名称', '甲方', '乙方', '合同金额', '错误信息'
  ];

  // BOM + header
  let csv = '\uFEFF' + headers.map(h => `"${h}"`).join(',') + '\n';

  let totalInvoice = 0, totalTrain = 0, totalContract = 0;
  let successCount = 0, failCount = 0;

  for (const item of results) {
    const d = item.data || {};
    const type = item.type || 'invoice';
    const row = new Array(23).fill('');

    row[0] = safeStr(item.file?.name || '');
    row[1] = safeStr(item.newName || '');
    row[3] = type === 'train' ? '火车票' : type === 'contract' ? '合同' : '发票';

    if (item.status === 'error' || type === 'error') {
      row[2] = '失败';
      row[22] = safeStr(item.error || '');
      failCount++;
    } else {
      row[2] = '成功';
      successCount++;

      if (type === 'train') {
        row[4] = safeStr(d.date || '');
        row[11] = safeStr(d.train_number || '');
        row[12] = safeStr(d.from_station || '');
        row[13] = safeStr(d.to_station || '');
        row[14] = safeStr(d.passenger_name || '');
        row[15] = safeStr(d.seat || '');
        row[16] = safeStr(d.seat_type || '');
        row[17] = safeStr(d.price || '');
        totalTrain += fmtAmt(d.price);
      } else if (type === 'contract') {
        row[4] = safeStr(d.sign_date || '');
        row[18] = safeStr(d.contract_name || '');
        row[19] = safeStr(d.party_a || '');
        row[20] = safeStr(d.party_b || '');
        row[21] = safeStr(d.amount || '');
        totalContract += fmtAmt(d.amount);
      } else {
        row[4]  = safeStr(d.date || '');
        row[5]  = safeStr(d.invoice_number || '');
        row[6]  = safeStr(d.buyer || '');
        row[7]  = safeStr(d.supplier || '');
        row[8]  = safeStr(d.tax_free_amount || '');
        row[9]  = safeStr(d.tax_amount || '');
        row[10] = safeStr(d.amount || '');
        totalInvoice += fmtAmt(d.amount);
      }
    }

    csv += row.map(c => `"${c}"`).join(',') + '\n';
  }

  // 汇总行
  csv += `\n"合计（成功 ${successCount} 张，失败 ${failCount} 张）","","","","","","","","${totalInvoice.toFixed(2)}","","","","","","","${totalTrain.toFixed(2)}","","","","${totalContract.toFixed(2)}",""\n`;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8-sig;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `发票识别结果_${Date.now()}.csv`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

/* ========= Excel 下载（对齐 Python _build_excel_bytes） ========= */

export function downloadExcel(results) {
  if (!window.XLSX) { toast('SheetJS 未加载'); return; }
  if (!results || !results.length) { toast('没有可导出的文件'); return; }

  // 简单 JSON 导出（完整格式版后续可扩）
  const data = results.map(r => {
    const d = r.data || {};
    const type = r.type || 'invoice';
    const base = {
      '原文件名': r.file?.name || '',
      '新文件名': r.newName || '',
      '状态': (r.status === 'error' || type === 'error') ? '失败' : '成功',
      '类型': type === 'train' ? '火车票' : type === 'contract' ? '合同' : '发票',
      '日期': d.date || d.sign_date || ''
    };
    if (type === 'invoice') {
      Object.assign(base, {
        '发票号码': d.invoice_number || '',
        '购买方': d.buyer || '',
        '销售方': d.supplier || '',
        '金额(不含税)': d.tax_free_amount || '',
        '税额': d.tax_amount || '',
        '价税合计': d.amount || ''
      });
    } else if (type === 'train') {
      Object.assign(base, {
        '车次': d.train_number || '',
        '出发站': d.from_station || '',
        '到达站': d.to_station || '',
        '乘客姓名': d.passenger_name || '',
        '座位': d.seat || '',
        '座位类型': d.seat_type || '',
        '票价': d.price || ''
      });
    } else if (type === 'contract') {
      Object.assign(base, {
        '合同名称': d.contract_name || '',
        '甲方': d.party_a || '',
        '乙方': d.party_b || '',
        '合同金额': d.amount || ''
      });
    }
    if (r.status === 'error') base['错误信息'] = r.error || '';
    return base;
  });

  const ws = XLSX.utils.json_to_sheet(data, { cellDates: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '识别结果');

  // 设置列宽（粗略）
  const widths = [
    { wch: 28 }, { wch: 36 }, { wch: 8 }, { wch: 10 }, { wch: 14 },
    { wch: 18 }, { wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
    { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 10 },
    { wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 20 }
  ];
  ws['!cols'] = widths;

  XLSX.writeFile(wb, `发票识别结果_${Date.now()}.xlsx`);
}

/* ========= Toast（兜底） ========= */

function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) { console.warn(msg); return; }
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.add('hidden'), 2500);
}
