/**
 * export.js
 * ZIP / CSV / Excel 导出
 *
 * 挂载到全局: window.EXPORT
 */

(function (global) {

/* ========= 颜色常量 ========= */

var C = {
  INV_HDR:  'FF276749',
  TRN_HDR:  'FF2B6CB0',
  CTR_HDR:  'FF6B21A8',
  META_HDR: 'FF4A5568',
  INV_ROW:  'FFE6F4EA',
  TRN_ROW:  'FFE8F0FE',
  CTR_ROW:  'FFF3E8FE',
  FAIL_ROW: 'FFFFF3CD',
  SUM_ROW:  'FFFFF8E1',
  WHITE:    'FFFFFFFF'
};

/* ========= 工具 ========= */

function fmtAmt(v) {
  var n = parseFloat(String(v).replace(/[¥￥,，]/g, '').replace(/元$/g, ''));
  return isNaN(n) ? 0 : n;
}

function safeStr(v, max) {
  v = String(v || '').replace(/"/g, '""');
  if (max) v = v.slice(0, max);
  return v;
}

function toast(msg) {
  var t = document.getElementById('toast');
  if (!t) { console.warn(msg); return; }
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function() { t.classList.add('hidden'); }, 2500);
}
global.toast = toast;

/* ========= ZIP 下载 ========= */

function downloadZip(results) {
  if (!global.JSZip) { toast('JSZip 未加载'); return; }
  if (!results || !results.length) { toast('没有可导出的文件'); return; }

  var zip = new global.JSZip();
  results.forEach(function(r, i) {
    if (!r || !r.file) return;
    var fname = r.newName || (r.file.name || ('file_' + i));
    fname = fname.replace(/[\\/:*?"<>|]/g, '_');
    zip.file(fname, r.file);
  });

  zip.generateAsync({type: 'blob'}).then(function(blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '发票_' + Date.now() + '.zip';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }).catch(function(err) { console.error('ZIP 生成失败:', err); toast('ZIP 导出失败'); });
}

/* ========= CSV 下载 ========= */

function downloadCsv(results) {
  if (!results || !results.length) { toast('没有可导出的文件'); return; }

  var headers = [
    '原文件名', '新文件名', '状态', '类型', '日期',
    '发票号码', '购买方', '销售方', '金额(不含税)', '税额', '价税合计',
    '车次', '出发站', '到达站', '乘客姓名', '座位', '座位类型', '票价',
    '合同名称', '甲方', '乙方', '合同金额', '错误信息'
  ];

  var csv = '\uFEFF' + headers.map(function(h){return '"'+h+'"';}).join(',') + '\n';

  var totalInvoice = 0, totalTrain = 0, totalContract = 0;
  var successCount = 0, failCount = 0;

  for (var i = 0; i < results.length; i++) {
    var item = results[i];
    var d = (item && item.data) || {};
    var type = (item && item.type) || '发票';
    var row = new Array(23).fill('');

    row[0] = safeStr(item.file && item.file.name || '');
    row[1] = safeStr(item.newName || '');
    row[3] = type;

    if ((item && item.status === 'error') || type === 'error') {
      row[2] = '失败';
      row[22] = safeStr((item && item.error) || '');
      failCount++;
    } else {
      row[2] = '成功';
      successCount++;

      if (type === '火车票' || type === '飞机票' || type === '打车票') {
        row[4]  = safeStr(d.date || '');
        row[11] = safeStr(d.train_number || '');
        row[12] = safeStr(d.from_station || '');
        row[13] = safeStr(d.to_station || '');
        row[14] = safeStr(d.passenger_name || '');
        row[15] = safeStr(d.seat || '');
        row[16] = safeStr(d.seat_type || '');
        row[17] = safeStr(d.price || d.amount || '');
        totalTrain += fmtAmt(d.price || d.amount);
      } else if (type === '合同') {
        row[4]  = safeStr(d.sign_date || '');
        row[18] = safeStr(d.contract_name || '');
        row[19] = safeStr(d.party_a || '');
        row[20] = safeStr(d.party_b || '');
        row[21] = safeStr(d.amount || '');
        totalContract += fmtAmt(d.amount);
      } else {
        // 发票、住宿费
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

    csv += row.map(function(c){return '"'+c+'"';}).join(',') + '\n';
  }

  csv += '\n"合计（成功 ' + successCount + ' 张，失败 ' + failCount + ' 张）","","","","","","","' + totalInvoice.toFixed(2) + '","","","","","","' + totalTrain.toFixed(2) + '","","","' + totalContract.toFixed(2) + '",""\n';

  var blob = new Blob([csv], {type: 'text/csv;charset=utf-8-sig;'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '发票识别结果_' + Date.now() + '.csv';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

/* ========= Excel 下载 ========= */

function downloadExcel(results) {
  if (!global.XLSX) { toast('SheetJS 未加载'); return; }
  if (!results || !results.length) { toast('没有可导出的文件'); return; }

  var wb = global.XLSX.utils.book_new();

  var titleRow = ['原文件名','新文件名','状态','类型','日期',
    '发票号码','购买方','销售方','金额(不含税)','税额','价税合计',
    '车次','出发站','到达站','乘客姓名','座位','座位类型','票价',
    '合同名称','甲方','乙方','合同金额','错误信息'];

  var dataRows = [titleRow];

  var totalInvoice = 0, totalTrain = 0, totalContract = 0;
  var successCount = 0, failCount = 0;

  for (var i = 0; i < results.length; i++) {
    var item = results[i];
    var d = (item && item.data) || {};
    var type = (item && item.type) || '发票';
    var row = new Array(23).fill('');

    row[0] = (item.file && item.file.name) || '';
    row[1] = item.newName || '';

    if ((item && item.status === 'error') || type === 'error') {
      row[2] = '失败';
      row[22] = (item && item.error) || '';
      failCount++;
    } else {
      row[2] = '成功';
      successCount++;

      if (type === '火车票' || type === '飞机票' || type === '打车票') {
        row[3]  = type;
        row[4]  = d.date || '';
        row[11] = d.train_number || '';
        row[12] = d.from_station || '';
        row[13] = d.to_station || '';
        row[14] = d.passenger_name || '';
        row[15] = d.seat || '';
        row[16] = d.seat_type || '';
        row[17] = d.price || d.amount || '';
        totalTrain += fmtAmt(d.price || d.amount);
      } else if (type === '合同') {
        row[3]  = '合同';
        row[4]  = d.sign_date || '';
        row[18] = d.contract_name || '';
        row[19] = d.party_a || '';
        row[20] = d.party_b || '';
        row[21] = d.amount || '';
        totalContract += fmtAmt(d.amount);
      } else {
        row[3]  = type || '发票';
        row[4]  = d.date || '';
        row[5]  = d.invoice_number || '';
        row[6]  = d.buyer || '';
        row[7]  = d.supplier || '';
        row[8]  = d.tax_free_amount || '';
        row[9]  = d.tax_amount || '';
        row[10] = d.amount || '';
        totalInvoice += fmtAmt(d.amount);
      }
    }

    dataRows.push(row);
  }

  dataRows.push([
    '合计（成功 ' + successCount + '，失败 ' + failCount + '）',
    '','','','',
    '','', '', '', totalInvoice.toFixed(2),
    '','','','', '', '', '', totalTrain.toFixed(2),
    '','','', '',
    ''
  ]);

  var ws = global.XLSX.utils.aoa_to_sheet(dataRows);

  ws['!cols'] = [
    {wch:28},{wch:36},{wch:8},{wch:10},{wch:14},
    {wch:18},{wch:20},{wch:20},{wch:14},{wch:12},{wch:12},
    {wch:10},{wch:14},{wch:14},{wch:14},{wch:10},{wch:12},{wch:10},
    {wch:20},{wch:16},{wch:16},{wch:14},{wch:20}
  ];

  if (global.XLSX.utils && ws['!ref']) {
    var range = global.XLSX.utils.decode_range(ws['!ref']);
    for (var c = 0; c <= 22; c++) {
      var addr = global.XLSX.utils.encode_cell({r:0, c:c});
      var hdrColor = (c >= 0 && c <= 4) ? C.META_HDR :
                    (c >= 5 && c <= 10) ? C.INV_HDR :
                    (c >= 11 && c <= 17) ? C.TRN_HDR :
                    (c >= 18 && c <= 21) ? C.CTR_HDR : C.META_HDR;
      if (ws[addr]) {
        ws[addr].s = {
          font: {bold: true, color: {rgb: C.WHITE}, name: '微软雅黑', sz: 10},
          fill: {fgColor: {rgb: hdrColor}},
          alignment: {horizontal: 'center', vertical: 'center', wrapText: true},
          border: {top:{style:'thin',color:{rgb:'FFCCCCCC'}},bottom:{style:'thin',color:{rgb:'FFCCCCCC'}},left:{style:'thin',color:{rgb:'FFCCCCCC'}},right:{style:'thin',color:{rgb:'FFCCCCCC'}}}
        };
      }
    }
    for (var r = 1; r <= results.length; r++) {
      var itemType = (results[r-1] && results[r-1].type) || '发票';
      var isErr = (results[r-1] && results[r-1].status === 'error') || itemType === 'error';
      var rowColor = isErr ? C.FAIL_ROW :
                        (itemType === '火车票' || itemType === '飞机票' || itemType === '打车票') ? C.TRN_ROW :
                        itemType === '合同' ? C.CTR_ROW : C.INV_ROW;
      for (var cc = 0; cc <= 22; cc++) {
        var a2 = global.XLSX.utils.encode_cell({r:r, c:cc});
        if (ws[a2]) {
          ws[a2].s = {
            font: {name: '微软雅黑', sz: 9, color: {rgb: 'FF333333'}},
            fill: {fgColor: {rgb: rowColor}},
            border: {top:{style:'thin',color:{rgb:'FFCCCCCC'}},bottom:{style:'thin',color:{rgb:'FFCCCCCC'}},left:{style:'thin',color:{rgb:'FFCCCCCC'}},right:{style:'thin',color:{rgb:'FFCCCCCC'}}}
          };
        }
      }
    }
    var sumR = results.length + 1;
    for (var sc = 0; sc <= 22; sc++) {
      var a3 = global.XLSX.utils.encode_cell({r:sumR, c:sc});
      if (ws[a3]) {
        ws[a3].s = {
          font: {bold: true, name: '微软雅黑', sz: 10, color: {rgb: 'FF333333'}},
          fill: {fgColor: {rgb: C.SUM_ROW}},
          border: {top:{style:'thin',color:{rgb:'FFCCCCCC'}},bottom:{style:'thin',color:{rgb:'FFCCCCCC'}},left:{style:'thin',color:{rgb:'FFCCCCCC'}},right:{style:'thin',color:{rgb:'FFCCCCCC'}}}
        };
      }
    }
  }

  global.XLSX.utils.book_append_sheet(wb, ws, '识别结果');
  global.XLSX.writeFile(wb, '发票识别结果_' + Date.now() + '.xlsx');
}

/* ========= 暴露到全局 ========= */

global.EXPORT = {
  downloadZip:    downloadZip,
  downloadCsv:   downloadCsv,
  downloadExcel:  downloadExcel
};

})(window);
