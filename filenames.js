/**
 * filenames.js
 * 命名规则 —— 逐行对齐原始 app.py（0804 完整版）
 *
 * 挂载到全局: window.FN
 *
 * 发票:    日期_销售方_购买方_金额元.ext
 * 火车票:  日期_出发站-到达站_票价元.ext
 * 合同:    签订日期_合同名称_甲方关键字_乙方关键字_金额元.ext
 *
 * 关键约束（与 Python 版完全一致）：
 *   - 日期格式 YYYY-MM-DD，无法识别时为 '0000-01-01'
 *   - 公司名截取前 20 字符（发票）/ 前 6 字（合同方名）
 *   - 合同方名先去括号地名、再去企业后缀、再取前 6 字
 *   - 金额永远保留两位小数 + "元" 后缀（整数不显示小数）
 *   - 非法字符清洗: \/:*?"<>|
 *   - 连续下划线合并为单个
 */

(function (global) {

  /* ========= 工具函数 ========= */

  function safeStr(s, maxLen) {
    if (!s) return '';
    s = String(s).trim();
    // 去掉括号及括号内内容（含中英文括号）
    s = s.replace(/[（(][^）)]*[）)]/g, '');
    // 去掉路径/文件非法字符
    s = s.replace(/[\\/:*?"<>|\[\]【】\n\r\t]/g, '');
    // 合并空白
    s = s.replace(/\s+/g, '');
    if (maxLen) s = s.slice(0, maxLen);
    return s;
  }

  function safeDate(d) {
    if (!d) return '0000-01-01';
    d = String(d).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '0000-01-01';
    // 校验年月日合法性
    var parts = d.split('-');
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var day = parseInt(parts[2], 10);
    if (y < 1900 || y > 2100) return '0000-01-01';
    if (m < 1 || m > 12) return '0000-01-01';
    if (day < 1 || day > 31) return '0000-01-01';
    return d;
  }

  function safeAmount(amt) {
    if (amt === null || amt === undefined || amt === '') return '0.00';
    // 支持 "1,234.56" / "¥100" / "100元" 等格式
    var cleaned = String(amt).replace(/[¥￥,，]/g, '').replace(/元$/g, '').trim();
    var n = parseFloat(cleaned);
    if (isNaN(n) || n < 0) return '0.00';
    return n.toFixed(2);
  }

  /** 清理多余下划线和首尾标点 */
  function cleanFinalName(name) {
    name = name.replace(/_+/g, '_');
    name = name.replace(/^_+|_+$/g, '');
    name = name.replace(/[：:\s，,。.]+$/g, '');
    return name;
  }

  function extractExt(filename) {
    if (!filename) return '.pdf';
    if (filename.indexOf('.') !== -1) {
      return '.' + filename.split('.').pop().toLowerCase();
    }
    return '.pdf';
  }

  /* ========= 发票命名 ========= */

  /**
   * 完全对齐 Python generate_filename():
   *   f"{date}_{supplier}_{buyer}_{amount}元{original_ext}"
   */
  function genInvoiceName(data, filename) {
    var ext = extractExt(filename);

    var date     = safeDate(data && data.date);
    var supplier = safeStr(data && data.supplier, 20) || '';
    var buyer    = safeStr(data && data.buyer, 20)    || '';
    var amount   = safeAmount(data && data.amount);

    // 严格按 Python 格式拼接
    var name = date + '_' + supplier + '_' + buyer + '_' + amount + '元' + ext;

    name = cleanFinalName(name);

    return name || ('invoice_' + Date.now() + ext);
  }

  /* ========= 火车票命名 ========= */

  /**
   * 完全对齐 Python generate_train_filename():
   *   parts = [date, route, f"{price}元"]  (route = "出发-到达" 或空)
   *   '_'.join(parts) + ext
   */
  function genTrainName(data, filename) {
    var ext = extractExt(filename);

    var date  = safeDate(data && data.date);
    var fromS = safeStr(data && data.from_station, 10);
    var toS   = safeStr(data && data.to_station, 10);
    var price = safeAmount(data && data.price);

    // 路线拼接（与 Python 一致）
    var route = '';
    if (fromS && toS) route = fromS + '-' + toS;
    else if (fromS) route = fromS;
    else if (toS) route = toS;

    // 只拼接非空部分（与 Python list comprehension 一致）
    var parts = [];
    if (date  !== '0000-01-01') parts.push(date);
    if (route)                    parts.push(route);
    parts.push(price + '元');

    var name = parts.join('_') + ext;

    name = cleanFinalName(name);

    return name || ('train_' + Date.now() + ext);
  }

  /* ========= 合同命名 ========= */

  /**
   * 完全对齐 Python _abbreviate_party() + generate_contract_filename()
   *
   * _abbreviate_party 逻辑:
   *   1. 去括号内地名
   *   2. 按长度从长到短剥离企业后缀（避免短后缀先匹配漏剥）
   *   3. 保留至少 2 字
   *   4. >6 字取前 6 字
   */
  function abbreviateParty(name) {
    if (!name) return '';
    // 1. 去括号内地名
    name = name.replace(/[（(][^）)]{1,8}[）)]/g, '').trim();
    name = name.replace(/\s+/g, '');
    if (!name) return '';

    // 2. 按长度从长到短尝试剥离（与 Python _SUFFIXES 顺序一致）
    var SUFFIXES = [
      '有限责任公司', '股份有限公司', '集团有限公司', '集团公司',
      '总公司', '分公司', '有限公司'
    ];
    for (var i = 0; i < SUFFIXES.length; i++) {
      var sfx = SUFFIXES[i];
      if (name.endsWith(sfx)) {
        var candidate = name.slice(0, name.length - sfx.length);
        if (candidate.length >= 2) {
          name = candidate;
          break;
        }
      }
    }

    // 3. >6 字取前 6 字
    if (name.length > 6) name = name.slice(0, 6);

    return name;
  }

  function genContractName(data, filename) {
    var ext = extractExt(filename);

    var date          = safeDate(data && data.sign_date);
    var contractName  = safeStr(data && data.contract_name, 15) || '合同';
    var partyA        = abbreviateParty(data && data.party_a);
    var partyB        = abbreviateParty(data && data.party_b);
    var amountRaw     = data && data.amount;

    // 对齐 Python:
    //   parts = [date, contract_name]
    //   if party_a_abbr: parts.append(party_a_abbr)
    //   if party_b_abbr: parts.append(party_b_abbr)
    //   if amount: parts.append(f"{amount}元")
    var parts = [];
    if (date !== '0000-01-01') parts.push(date);
    parts.push(contractName);
    if (partyA) parts.push(partyA);
    if (partyB) parts.push(partyB);

    // 金额格式化（与 Python 一致：整数不显示小数）
    if (amountRaw !== null && amountRaw !== undefined && amountRaw !== '') {
      var n = parseFloat(String(amountRaw).replace(/[¥￥,，]/g, '').replace(/元$/g, ''));
      if (!isNaN(n) && n > 0) {
        var amtStr = (n === Math.floor(n)) ? (Math.floor(n) + '元') : (n.toFixed(2) + '元');
        parts.push(amtStr);
      }
    }

    var name = parts.join('_') + ext;

    name = cleanFinalName(name);

    return name || ('contract_' + Date.now() + ext);
  }

  /* ========= 统一入口（供 app.js 调用） ========= */

  function genAnyFilename(data, docType, filename) {
    if (docType === 'train')    return genTrainName(data, filename);
    if (docType === 'contract') return genContractName(data, filename);
    return genInvoiceName(data, filename);
  }

  /* ========= 暴露到全局 ========= */

  global.FN = {
    genInvoiceName:  genInvoiceName,
    genTrainName:    genTrainName,
    genContractName:  genContractName,
    genAnyFilename:   genAnyFilename,
    abbreviateParty:  abbreviateParty,
    safeDate:         safeDate,
    safeAmount:       safeAmount,
    safeStr:          safeStr
  };

})(window);
