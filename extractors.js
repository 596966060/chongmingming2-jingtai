/**
 * extractors.js
 * 核心抽取逻辑 —— 逐行对齐原始 app.py（0804 完整版）
 * 修订：增强 detectDocType 返回中文类型，extractFromFilename 支持 "月.日" 格式
 *
 * 挂载到全局: window.EX
 *
 * 包含：
 *   - detectDocType()        文档类型判断（火车票 > 合同 > 发票，返回中文）
 *   - extractInvoiceFields()  发票字段抽取
 *   - extractTrainFields()    火车票字段抽取
 *   - extractContractFields() 合同字段抽取
 *   - extractFromFile()       OCR 入口（PDF 多页拼接 / 图片 / DOCX 降级）
 *   - extractFromFilename()   从文件名补充字段（支持 6.8 格式）
 */

(function (global) {

/* ================= 工具函数 ================= */

/** 公司名清洗（对齐 Python clean_company） */
function cleanCompany(s) {
  if (!s) return null;
  s = String(s).trim();

  // 截断在另一方标签处
  s = s.split(/(?:销售方|购买方)\s*名称/)[0];

  // 截断在纳税人/地址/开户/电话/监制机关处
  s = s.split(/(?:纳税人|识别号|地址[、，,]|电话|统一社会|监制机关|主管税务)/)[0];

  // 去掉末尾长数字串（税号）
  s = s.replace(/\s*\d{8,}.*$/, '');

  // 去掉括号内企业类型说明
  s = s.replace(/\s*[（(]\s*(?:个体工商户|个人独资|自然人|个人)\s*[）)]/, '');

  // 去掉末尾标点
  s = s.replace(/[：:\s，,。.]+$/g, '').trim();

  // 必须含中文
  if (!/[\u4e00-\u9fa5]/.test(s)) return null;
  if (s.length < 2 || s.length > 60) return null;

  // 拒绝纯后缀
  if (/^(?:有限(?:责任)?公司|股份有限公司|集团公司|有限公司|责任公司|公司)$/.test(s)) return null;

  // 拒绝发票字段标签词
  var LABEL_WORDS = ['名称', '金额', '税额', '地址', '电话', '合计', '税率',
    '备注', '开票人', '识别号', '统一社会', '纳税人', '规格',
    '项目', '单位', '数量', '单价', '备注', '信息'];
  if (LABEL_WORDS.indexOf(s) !== -1) return null;

  // 拒绝政府机关
  if (/税务[局所]|国家税务|地方税务|稽查局|国税局|地税局|财政局|监察局|市场监督|行政管理局|公安局|政府|监制机关|主管税务/.test(s)) return null;

  return s;
}

/* ================= 文档类型判断 ================= */

// 火车票关键词集合（对齐 Python _TRAIN_KEYWORDS）
var TRAIN_KEYWORDS = /车\s*次|检\s*票|候\s*车|动\s*车|高\s*铁|火\s*车\s*票|硬\s*卧|软\s*卧|硬\s*座|二\s*等\s*座|一\s*等\s*座|商\s*务\s*座|无\s*座|出\s*发\s*站|到\s*达\s*站|网络购票|铁路电子客票|中国铁路|12306|票价[：:\s]*[¥￥]?\d|列\s*车\s*号|乘\s*车\s*日|席\s*别|始\s*发\s*站|终\s*到\s*站|补\s*票|开\s*车\s*时\s*间|出\s*发\s*时\s*间|铁\s*路\s*客\s*票/;

// 合同关键词
var CONTRACT_PARTY_A = /甲\s*方|买\s*方|委\s*托\s*方|发\s*包\s*方|采\s*购\s*方|招\s*标\s*人/;
var CONTRACT_PARTY_B = /乙\s*方|卖\s*方|承\s*包\s*方|承\s*接\s*方|供\s*货\s*方|中\s*标\s*人/;
var CONTRACT_STRONG = /本\s*合\s*同|本\s*协\s*议|合\s*同\s*编\s*号|甲\s*乙\s*双\s*方|买\s*卖\s*双\s*方|委\s*托\s*方|发\s*包\s*方|合\s*同\s*金\s*额|合\s*同\s*总\s*额|合\s*同\s*总\s*价|平\s*等\s*自\s*愿|协\s*商\s*一\s*致|合\s*同\s*协\s*议\s*书|货\s*物\s*采\s*购\s*合\s*同|采\s*购\s*合\s*同|服\s*务\s*合\s*同|工\s*程\s*合\s*同|建\s*设\s*工\s*程\s*合\s*同/;

// 弱车次号检测（去掉 \b，中文无 word boundary）
var TRAIN_NUMBER_RE = /(?<![A-Z\d])([GDTZKCY]\d{1,4})(?!\d)/;

/**
 * detectDocType —— 修订版，返回中文类型
 */
function detectDocType(text) {
  if (!text) return '发票';
  // 1. 强火车票关键词（优先级最高）
  if (TRAIN_KEYWORDS.test(text)) return '火车票';
  // 2. 飞机票关键词
  if (/航空运输电子客票|行程单|旅客姓名|电子客票|登机牌|航班|机票|飞猪|携程.*机票/.test(text)) return '飞机票';
  // 3. 住宿
  if (/住宿|宾馆|酒店|旅店|入住|如家|汉庭|全季/.test(text)) return '住宿费';
  // 4. 打车
  if (/出租汽车|出租车发票|计价器|滴滴|T3出行|曹操出行|网约车/.test(text)) return '打车票';
  // 5. 合同强关键词
  var hasA = CONTRACT_PARTY_A.test(text);
  var hasB = CONTRACT_PARTY_B.test(text);
  var hasS = CONTRACT_STRONG.test(text);
  if (hasS || (hasA && hasB)) return '合同';
  // 6. 弱车次号检测
  if (TRAIN_NUMBER_RE.test(text)) return '火车票';
  return '发票';
}

/* ================= 文本预处理 ================= */

/** 对齐 Python _normalize_text：修复 OCR 拆行 & 统一标签 */
function normalizeText(text) {
  if (!text) return '';
  var lines = text.split('\n');
  var out = [];
  var i = 0;
  while (i < lines.length) {
    var raw = lines[i];
    var stripped = raw.trim();
    // 向前看
    if (i + 1 < lines.length) {
      var nxt = lines[i + 1].trim();
      var nxtIsName = /^[名1l][称称][：:﹕]/.test(nxt);
      if (nxtIsName) {
        if (/^购(?:买方?|方)?(?:信息)?$/.test(stripped)) {
          out.push('购买方' + nxt);
          i += 2;
          continue;
        }
        if (/^销(?:售方?|方)?(?:信息)?$/.test(stripped)) {
          out.push('销售方' + nxt);
          i += 2;
          continue;
        }
      }
    }
    // 机动车/航空统一标签
    stripped = stripped.replace(/销货单位名称/g, '销售方名称');
    stripped = stripped.replace(/购货单位名称/g, '购买方名称');
    stripped = stripped.replace(/销货单位[：:]/g, '销售方名称：');
    stripped = stripped.replace(/购货单位[：:]/g, '购买方名称：');
    out.push(stripped);
    i++;
  }
  return out.join('\n');
}

/* ================= 发票字段抽取 ================= */

function extractInvoiceFields(text, stem) {
  var result = {
    date: null,
    invoice_number: null,
    buyer: null,
    supplier: null,
    amount: null,
    tax_free_amount: null,
    tax_amount: null,
    invoice_type: null
  };

  text = normalizeText(text);

  // === 日期 ===
  var datePatterns = [
    [/开票日期[：:\s]*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/, 1, 2, 3],
    [/日期[：:\s]*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/, 1, 2, 3],
    [/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/, 1, 2, 3],
    [/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/, 1, 2, 3],
    [/(?<!\d)(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/, 1, 2, 3]
  ];
  for (var di = 0; di < datePatterns.length; di++) {
    var dp = datePatterns[di];
    var m = text.match(dp[0]);
    if (m) {
      var y = parseInt(m[dp[1]], 10);
      var mo = parseInt(m[dp[2]], 10);
      var d = parseInt(m[dp[3]], 10);
      if (y >= 1900 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        result.date = y + '-' + String(mo).padStart(2,'0') + '-' + String(d).padStart(2,'0');
        break;
      }
    }
  }

  // === 发票号 ===
  var invPatterns = [
    /(?:发票号|号码)[：\s]*([A-Z0-9\)\(]{15,})/,
    /(?:发票号|号码)[：\s]*([0-9\)\(]{10,})/,
    /[A-Z0-9]{15,}/,
    /\d{15,25}/
  ];
  for (var ii = 0; ii < invPatterns.length; ii++) {
    var im = text.match(invPatterns[ii]);
    if (im) {
      var raw = im[1] || im[0];
      var clean = raw.replace(/[^\dA-Z0-9]/g, '');
      if (clean.length >= 13 && clean.length <= 25) {
        result.invoice_number = clean;
        break;
      }
    }
  }

  // === 购买方 / 销售方 ===
  function multiLineCompany(labelPat) {
    var re = new RegExp(labelPat + '[ \\t]*([^\\n]*)');
    var m = text.match(re);
    if (!m) return null;
    var first = m[1].trim();
    var rest = text.substring(m.index + m[0].length);
    var nl = rest.match(/[ \t]*([^\n]{1,40})/);
    var cont = nl ? nl[1].trim() : '';
    var isIncomplete = (!first || first.length < 6 ||
      /(?:有限|股份|集团|科技|责任|管理|实业|发展)\s*$/.test(first));
    var isContinuation = cont && /(?:公司|有限|责任|集团|股份|管理|科技|发展|实业)/.test(cont) &&
      !/(?:纳税人|识别号|地址|开户|电话|购买方|销售方|统一社会|信用代码)/.test(cont);
    if (isIncomplete && isContinuation) first = (first + cont).trim();
    else if (!first && cont && !/(?:纳税人|识别号|地址|开户|电话|购买方|销售方)/.test(cont)) first = cont;
    return first || null;
  }

  // 同行双名称
  var sameLineBoth = text.match(/[1l名]称[：:]\s*(.+?)\s{2,}[1l名]称[：:]\s*([^\n]+)/);
  // 显式双方
  var explicitBoth = text.match(/购买方\s*名称[：:]\s*(.+?)\s+销售方\s*名称[：:]\s*([^\n]+)/);

  var buyerRaw = multiLineCompany('购买方\\s*名称[：:]') ||
    multiLineCompany('(?:购买方|购\\s*方|买\\s*方)[^\\n]{0,30}?[1l名]称[：:]');
  var supplierRaw = multiLineCompany('销售方\\s*名称[：:]') ||
    multiLineCompany('(?:销售方|销\\s*方|卖\\s*方)[^\\n]{0,30}?[1l名]称[：:]') ||
    multiLineCompany('销[^\\n]{0,20}?名称[：:]');

  if (explicitBoth) {
    if (!buyerRaw) buyerRaw = explicitBoth[1];
    if (!supplierRaw) supplierRaw = explicitBoth[2];
  }

  if (buyerRaw && !result.buyer) result.buyer = cleanCompany(buyerRaw);
  if (supplierRaw && !result.supplier) result.supplier = cleanCompany(supplierRaw);

  if (sameLineBoth && (!result.buyer || !result.supplier)) {
    var b = cleanCompany(sameLineBoth[1]);
    var s = cleanCompany(sameLineBoth[2]);
    if (b && !result.buyer) result.buyer = b;
    if (s && !result.supplier) result.supplier = s;
  }

  // 策略2: 通用企业词尾
  if (!result.buyer || !result.supplier) {
    var companyLines = [];
    var pats = [/([\u4e00-\u9fa5]{2,}(?:公司|有限|分公司|集团|股份|企业|研究所|医院|学校|协会|中心|院|所|厂|部))/g];
    for (var pi = 0; pi < pats.length; pi++) {
      var mm;
      while ((mm = pats[pi].exec(text)) !== null) {
        var c = cleanCompany(mm[1]);
        if (c && companyLines.indexOf(c) === -1) companyLines.push(c);
      }
    }
    if (companyLines.length) {
      // 去掉已找到的一方
      var filtered = [];
      for (var fi = 0; fi < companyLines.length; fi++) {
        if (companyLines[fi] !== result.buyer && companyLines[fi] !== result.supplier) {
          filtered.push(companyLines[fi]);
        }
      }
      if (!result.buyer && filtered.length >= 1) result.buyer = filtered[0];
      if (!result.supplier && filtered.length >= 2) result.supplier = filtered[1];
      else if (!result.supplier && filtered.length >= 1 && filtered[0] !== result.buyer) result.supplier = filtered[0];
    }
  }

  // === 价税合计 ===
  function findAmount(patterns, txt) {
    for (var pi = 0; pi < patterns.length; pi++) {
      var ms = txt.match(patterns[pi]);
      if (ms) {
        try {
          var vals = [];
          for (var vi = 0; vi < ms.length; vi++) {
            vals.push(parseFloat(ms[vi].replace(/[^\d.]/g, '')));
          }
          vals.sort(function(a,b){return b-a;});
          return vals[0].toFixed(2);
        } catch(e) {}
      }
    }
    return null;
  }

  if (!result.amount) {
    var totalPats = [
      /价税合计[^0-9\n]{0,10}小写[）)]*\s*[垒¥￥垩圓Y]?\s*([0-9]{1,10}\.[0-9]{2})/,
      /小写[）)]*\s*[垒¥￥垩圓Y]?\s*([0-9]{1,10}\.[0-9]{2})/,
      /价税合计[^0-9\n]{0,20}([0-9]{1,10}\.[0-9]{2})/,
      /(?:合计|实付|应付|票价|金额)[：:\s]*[¥￥]?\s*([0-9]{1,10}\.[0-9]{2})/,
      /[¥￥垩圓Y垒]\s*([0-9]{1,10}(?:\.[0-9]{1,2})?)/,
      /(?<![0-9])([0-9]{1,10}\.[0-9]{2})(?![0-9])/
    ];
    result.amount = findAmount(totalPats, text);
  }

  // === 不含税 + 税额 ===
  var amtpat = /[¥￥垒垩圓Y半]?\s*([0-9]{1,10}\.[0-9]{2})/;
  var twoNum = text.match(new RegExp('合计\\s*' + amtpat.source + '[\\s\\n]+' + amtpat.source));
  if (twoNum) {
    result.tax_free_amount = parseFloat(twoNum[1]).toFixed(2);
    result.tax_amount      = parseFloat(twoNum[2]).toFixed(2);
  } else {
    var mTax = text.match(new RegExp('(?:合计税额|税\\s*额)[：:\\s]*' + amtpat.source));
    if (mTax) result.tax_amount = parseFloat(mTax[1]).toFixed(2);
    var mBase = text.match(new RegExp('(?:不含税|合计金额)[：:\\s]*' + amtpat.source));
    if (mBase) result.tax_free_amount = parseFloat(mBase[1]).toFixed(2);

    // 配对推断
    if (result.amount && (!result.tax_free_amount || !result.tax_amount)) {
      try {
        var total = parseFloat(result.amount);
        var decimals = [];
        var allDec = text.match(/\b(\d{1,8}\.\d{2})\b/g) || [];
        for (var ai = 0; ai < allDec.length; ai++) {
          var v = parseFloat(allDec[ai]);
          if (Math.abs(v - total) > 0.01 && v > 0 && decimals.indexOf(v) === -1) decimals.push(v);
        }
        decimals.sort(function(a,b){return a-b;});
        for (var bi = 0; bi < decimals.length; bi++) {
          for (var bj = bi+1; bj < decimals.length; bj++) {
            if (Math.abs(decimals[bi] + decimals[bj] - total) <= 0.05) {
              var bigger  = Math.max(decimals[bi], decimals[bj]);
              var smaller = Math.min(decimals[bi], decimals[bj]);
              if (!result.tax_free_amount) result.tax_free_amount = bigger.toFixed(2);
              if (!result.tax_amount) result.tax_amount = smaller.toFixed(2);
              bi = decimals.length; break;
            }
          }
        }
      } catch(e) {}
    }
  }

  return result;
}

/* ================= 特殊发票 ================= */

function extractSpecialInvoice(text, result) {
  // 机动车
  if (/机动车销售统一发票|机动车(?:出售|发票)/.test(text)) {
    result.invoice_type = '机动车发票';
    return false;
  }
  // 航空行程单
  if (/航空运输电子客票|行程单|旅客姓名|电子客票/.test(text)) {
    result.invoice_type = '航空行程单';
    var m = text.match(/旅客姓名[：:\s]+([^\n\s]{2,10})/);
    if (m) result.buyer = m[1].trim();
    var dep = text.match(/出发地[：:\s]+([^\n\s]{2,8})/);
    var arr = text.match(/目的地[：:\s]+([^\n\s]{2,8})/);
    if (dep && arr) result.supplier = dep[1].trim() + '-' + arr[1].trim();
    else if (dep) result.supplier = dep[1].trim();
    var m2 = text.match(/(?:票价|合计)[：:\s]*[¥￥]?\s*(\d+(?:\.\d{1,2})?)/);
    if (m2) result.amount = parseFloat(m2[1]).toFixed(2);
    return true;
  }
  // 出租车
  if (/出租汽车|出租车发票|计价器/.test(text)) {
    result.invoice_type = '出租车发票';
    var m3 = text.match(/(?:金额|合计)[：:\s]*[¥￥]?\s*(\d+(?:\.\d{1,2})?)/);
    if (m3) result.amount = parseFloat(m3[1]).toFixed(2);
    return true;
  }
  // 定额发票
  if (/定额发票|监制(?:章|机关)/.test(text) && text.length < 400) {
    result.invoice_type = '定额发票';
    var m4 = text.match(/[¥￥]?\s*(\d+(?:\.\d{1,2})?)\s*元/);
    if (m4) result.amount = parseFloat(m4[1]).toFixed(2);
    return true;
  }
  return false;
}

/* ================= 火车票字段抽取 ================= */

var STATION_SUFFIX = /[\u4e00-\u9fa5]{2,8}(?:站|虹桥|南|北|东|西|高铁)?/;
var SEAT_TYPES = ['商务座', '特等座', '一等座', '二等座', '软卧上', '软卧下', '硬卧上', '硬卧中',
  '硬卧下', '软卧', '硬卧', '硬座', '无座', '动卧'];

function extractTrainFields(text, stem) {
  var result = {
    date: null, train_number: null, from_station: null, to_station: null,
    passenger_name: null, seat: null, seat_type: null, price: null, depart_time: null
  };

  // 车次
  var tnLabeled = text.match(/(?:车\s*次|列\s*车\s*号)[：:\s]*([GDTZKCY]\d{1,4})/);
  if (tnLabeled) result.train_number = tnLabeled[1];
  else {
    var tnm = text.match(TRAIN_NUMBER_RE);
    if (tnm) result.train_number = tnm[1];
  }

  // 日期（屏蔽开票日期行）
  var textNoInvoice = text.replace(/开\s*票\s*日\s*期[：:\s]*\d{4}年\d{1,2}月\d{1,2}日/g, '');
  var datePats = [
    [/(?:乘车日期|出发日期|乘\s*车\s*日)[：:\s]*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/, 1, 2, 3],
    [/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/, 1, 2, 3],
    [/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/, 1, 2, 3]
  ];
  for (var di = 0; di < datePats.length; di++) {
    var dp = datePats[di];
    var src = (dp[1] === 2) ? textNoInvoice : text;
    var m = src.match(dp[0]);
    if (m) {
      var y = parseInt(m[dp[1]], 10), mo = parseInt(m[dp[2]], 10), d = parseInt(m[dp[3]], 10);
      if (y >= 1900 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        result.date = y + '-' + String(mo).padStart(2,'0') + '-' + String(d).padStart(2,'0');
        break;
      }
    }
  }

  // 出发时间
  var tm = text.match(/(?:出发时间|开车时间|发车)[：:\s]*(\d{1,2}:\d{2})/);
  if (tm) result.depart_time = tm[1];
  else {
    var tm2 = text.match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (tm2) result.depart_time = tm2[0].substring(0, 5);
  }

  // 乘客姓名
  var NAME_BLACKLIST = {'出发':'','到达':'','乘坐':'','车次':'','购票':'','旅客':'','列车':'','中国':'',
    '铁路':'','上海':'','北京':'','广州':'','深圳':'','成都':'','武汉':'','南京':'',
    '高铁':'','动车':'','候车':'','检票':'','开车':'','席别':'','座位':'','票价':''};
  var namePats = [
    /(?:姓\s*名|旅\s*客|购\s*票\s*人|乘\s*客)[：:\s]*([\u4e00-\u9fa5]{2,4})/,
    /([\u4e00-\u9fa5]{2,4})[（\(]?(?:居民身份证|身份证|护照)/,
    /([\u4e00-\u9fa5]{2,4})\s*\d{15,18}[Xx]?/,
    /([\u4e00-\u9fa5]{2,4})\s*\*{4,}/,
    /\*{4,}\d+\n([\u4e00-\u9fa5]{2,4})/,
    /([\u4e00-\u9fa5]{2,4})\s*[¥￥]\s*\d/
  ];
  for (var ni = 0; ni < namePats.length; ni++) {
    var nm = text.match(namePats[ni]);
    if (nm) {
      var n = nm[1].trim();
      if (!NAME_BLACKLIST[n]) { result.passenger_name = n; break; }
    }
  }

  // 站名黑名单
  var STATION_BLACKLIST = /^(?:出发站|到达站|始发站|终到站|目的地|经由|中转|检票口|候车|开车)$/;
  function cleanStation(name) {
    name = name.trim();
    if (STATION_BLACKLIST.test(name)) return '';
    if (name.endsWith('站') && name.length > 2) name = name.substring(0, name.length - 1);
    return name;
  }

  var excluded = {};
  if (result.passenger_name) excluded[result.passenger_name] = true;

  function findLabeledStation(labelRe) {
    var m = text.match(new RegExp(labelRe + '[ \\t]*([\\u4e00-\\u9fa5]{2,12})'));
    if (m) { var s = cleanStation(m[1]); if (s && !excluded[s]) return s; }
    var m2 = text.match(new RegExp(labelRe));
    if (m2) {
      var after = text.substring(m2.index + m2[0].length);
      var lines = after.split('\n');
      for (var li = 0; li < Math.min(4, lines.length); li++) {
        var line = lines[li].trim();
        if (!line) continue;
        if (/^[A-Za-z0-9\s\-]+$/.test(line)) continue;
        var ch = line.match(/([\u4e00-\u9fa5]{2,12})/);
        if (ch) { var s2 = cleanStation(ch[1]); if (s2 && !excluded[s2]) return s2; }
      }
    }
    return null;
  }

  var fromL = findLabeledStation('(?:出\\s*发\\s*站|始\\s*发\\s*站)');
  var toL   = findLabeledStation('(?:到\\s*达\\s*站|终\\s*到\\s*站|目\\s*的\\s*地)');
  if (fromL) result.from_station = fromL;
  if (toL)   result.to_station = toL;

  // 箭头分隔
  if (!result.from_station || !result.to_station) {
    var arrow = text.match(/([\u4e00-\u9fa5]{2,10}(?:站)?)\s*[→➜>—至]\s*([\u4e00-\u9fa5]{2,10}(?:站)?)/);
    if (arrow) {
      var f = cleanStation(arrow[1]), t = cleanStation(arrow[2]);
      if (f && !result.from_station) result.from_station = f;
      if (t && !result.to_station) result.to_station = t;
    }
  }

  // 方位词后缀
  if (!result.from_station || !result.to_station) {
    var cand = text.match(/([\u4e00-\u9fa5]{2,8}(?:虹桥|高铁|北站|南站|东站|西站)(?:站)?|[\u4e00-\u9fa5]{4,8}(?:南|北|东|西)(?:站)?)/g) || [];
    var cleanCands = [];
    for (var ci = 0; ci < cand.length; ci++) {
      var cs = cleanStation(cand[ci]);
      if (cs && !excluded[cs] && cleanCands.indexOf(cs) === -1) cleanCands.push(cs);
    }
    if (!result.from_station && cleanCands.length >= 1) result.from_station = cleanCands[0];
    if (!result.to_station && cleanCands.length >= 2) result.to_station = cleanCands[1];
  }

  // 最终校验：出发==到达 → 清空
  if (result.from_station && result.from_station === result.to_station) {
    result.from_station = null;
  }

  // 座位类型
  for (var si = 0; si < SEAT_TYPES.length; si++) {
    if (text.indexOf(SEAT_TYPES[si]) !== -1) { result.seat_type = SEAT_TYPES[si]; break; }
  }
  if (!result.seat_type) {
    var xi = text.match(/席\s*别[：:\s]*([\u4e00-\u9fa5]{2,5})/);
    if (xi) result.seat_type = xi[1];
  }

  // 座位号
  var seatPats = [
    /(\d{1,2}\s*车\s*\d{1,2}\s*[A-F号])/,
    /([A-F]\d\s*车厢?\s*\d{1,2}\s*号?)/,
    /(\d{1,2}[A-F]\d?)/
  ];
  for (var spi = 0; spi < seatPats.length; spi++) {
    var sm = text.match(seatPats[spi]);
    if (sm) { result.seat = sm[1].trim(); break; }
  }

  // 票价
  var pricePats = [
    /(?:票\s*价|价\s*格|金\s*额|票\s*款)[：:\s]*[¥￥]?\s*(\d+\.?\d*)/,
    /[¥￥]\s*(\d+\.?\d*)/,
    /(\d{2,5}\.\d{1,2})\s*元/,
    /合\s*计[：:\s]*[¥￥]?\s*(\d+\.?\d*)/
  ];
  for (var ppi = 0; ppi < pricePats.length; ppi++) {
    var pm = text.match(pricePats[ppi]);
    if (pm) {
      try { result.price = parseFloat(pm[1]).toFixed(2); break; } catch(e) {}
    }
  }
  if (!result.price) {
    var decs = text.match(/(?<!\d)(\d{1,5}\.\d{1,2})(?!\d)/g) || [];
    var vals = [];
    for (var vi = 0; vi < decs.length; vi++) {
      var v = parseFloat(decs[vi]);
      if (v >= 1 && v <= 10000) vals.push(v);
    }
    if (vals.length) { vals.sort(function(a,b){return b-a;}); result.price = vals[0].toFixed(2); }
  }

  return result;
}

/* ================= 合同字段抽取 ================= */

function extractContractFields(text) {
  var result = { contract_name: '', sign_date: '', party_a: '', party_b: '', amount: '' };
  var lines = text.split('\n').map(function(l){return l.trim();}).filter(function(l){return l;});

  // 合同名称
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(/(?:合同名称|协议名称|项目名称)[：:]\s*(.{2,40})/);
    if (m) {
      var n = m[1].replace(/\s+/g, '').replace(/[（(].*?[）)]/g, '').trim();
      if (n && n.length >= 2) { result.contract_name = n.substring(0, 20); break; }
    }
  }
  if (!result.contract_name) {
    for (var i2 = 0; i2 < Math.min(10, lines.length); i2++) {
      var c = lines[i2].replace(/[《》【】\[\]（(）)\s]+/g, '');
      if (c.length > 2 && c.length <= 20 && /合同|协议书/.test(c)) {
        if (!['合同','协议书','协议','本合同','本协议'].includes(c)) {
          result.contract_name = c; break;
        }
      }
    }
  }
  if (!result.contract_name) {
    var m3 = text.match(/[\u4e00-\u9fff]{2,12}(?:采购合同|服务合同|工程合同|合同|协议书)/);
    if (m3) result.contract_name = m3[0].substring(0, 20);
  }

  // 签订日期
  var datePats = [
    /(?:签订|签署|签约|合同)\s*[日期时间]*\s*[：:\s]+(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    /于\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/
  ];
  for (var di = 0; di < datePats.length; di++) {
    var m = text.match(datePats[di]);
    if (m) {
      result.sign_date = m[1] + '-' + String(parseInt(m[2])).padStart(2,'0') + '-' + String(parseInt(m[3])).padStart(2,'0');
      break;
    }
  }

  // 甲方/乙方
  function cleanParty(raw) {
    var v = raw.replace(/[（(][^）)]{1,8}[）)]/g, '').trim().replace(/\s+/g, '');
    v = v.split(/甲方|乙方|买方|卖方|承包方|委托方|招标人/)[0];
    return v.length >= 2 ? v.substring(0, 30) : '';
  }

  var A_KW = /(?:甲\s*方|买\s*方|委\s*托\s*方|发\s*包\s*方|采\s*购\s*方|招\s*标\s*人)/;
  var B_KW = /(?:乙\s*方|卖\s*方|承\s*包\s*方|承\s*接\s*方|供\s*货\s*方|中\s*标\s*人)/;
  var aPats = [new RegExp(A_KW.source + '(?:\\s*单位全称|\\s*名称|\\s*（盖章）|\\s*\\(盖章\\))?\\s*[：:\\s]+([^\\n]{2,35})')];
  var bPats = [new RegExp(B_KW.source + '(?:\\s*单位全称|\\s*名称|\\s*（盖章）|\\s*\\(盖章\\))?\\s*[：:\\s]+([^\\n]{2,35})')];

  for (var li = 0; li < lines.length; li++) {
    if (!result.party_a) {
      for (var pi = 0; pi < aPats.length; pi++) {
        var m = lines[li].match(aPats[pi]);
        if (m) { var v = cleanParty(m[1]); if (v.length >= 2) result.party_a = v; break; }
      }
    }
    if (!result.party_b) {
      for (var pi2 = 0; pi2 < bPats.length; pi2++) {
        var m2 = lines[li].match(bPats[pi2]);
        if (m2) { var v2 = cleanParty(m2[1]); if (v2.length >= 2) result.party_b = v2; break; }
      }
    }
    if (result.party_a && result.party_b) break;
  }

  // 兜底
  if (!result.party_a) {
    var m4 = text.match(new RegExp(A_KW.source + '[\\s：:]+([^\\n（(]{2,30})'));
    if (m4) result.party_a = cleanParty(m4[1]);
  }
  if (!result.party_b) {
    var m5 = text.match(new RegExp(B_KW.source + '[\\s：:]+([^\\n（(]{2,30})'));
    if (m5) result.party_b = cleanParty(m5[1]);
  }

  // 金额
  function parseAmt(raw, unit) {
    try {
      var v = parseFloat(raw.replace(/[,，]/g, ''));
      if (unit && unit.indexOf('万') !== -1) v *= 10000;
      return v.toFixed(2);
    } catch(e) { return raw; }
  }
  var amtPats = [
    new RegExp('(?:合同[总]?[额价款金]|总金额|总价款|合同总价|合同价款|价款总额)[^0-9¥￥]{0,15}[¥￥]?\\s*(\\d[\\d,，]*\\.?\\d*)\s*(万元|元)?'),
    /人民币\s*[¥￥]?\s*(\d[\d,，]*\.?\d+)\s*(万元|元)?/,
    /[¥￥]\s*(\d[\d,，]*\.?\d+)\s*(万元|元)?/,
    /(\d[\d,，]{1,8}\.?\d*)\s*(万元)/
  ];
  for (var ai = 0; ai < amtPats.length; ai++) {
    var m = text.match(amtPats[ai]);
    if (m) {
      var unit = (m[2] || '');
      var rawNum = m[1];
      var unitStr = '';
      if (m.length >= 3 && m[2]) unitStr = m[2];
      result.amount = parseAmt(rawNum, unitStr);
      break;
    }
  }

  return result;
}

/* ================= 从文件名补充字段（修订：支持 月.日） ================= */

function extractFromFilename(stem) {
  var result = {};
  if (!stem) return result;
  var parts = stem.split(/[_\-\s]/);
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    // 发票号（15-25位数字）
    if (/^\d{15,25}$/.test(p)) result.invoice_number = result.invoice_number || p;
    // 8位日期 20250608
    else if (/^20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/.test(p)) {
      var y = parseInt(p.substring(0,4)), mo = parseInt(p.substring(4,6)), d = parseInt(p.substring(6,8));
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        result.date = result.date || (y + '-' + String(mo).padStart(2,'0') + '-' + String(d).padStart(2,'0'));
      }
    }
    // 新增：支持 "6.8" 或 "6-8" 格式（如住宿费发票-6.8-广德）
    else if (/^(\d{1,2})[.\-](\d{1,2})$/.test(p)) {
      var mo = parseInt(RegExp.$1), d = parseInt(RegExp.$2);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        var year = new Date().getFullYear();
        result.date = result.date || (year + '-' + String(mo).padStart(2,'0') + '-' + String(d).padStart(2,'0'));
      }
    }
    // 中文片段（公司名 / 地点）
    else if (/[\u4e00-\u9fa5]/.test(p) && p.length >= 4) {
      result.buyer = result.buyer || p;
    }
  }
  return result;
}

/* ================= 图像预处理（对齐 Python CLAHE） ================= */

function preprocessCanvas(canvas) {
  var ctx = canvas.getContext('2d');
  var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  var data = imgData.data;
  // 灰度
  var gray = new Uint8Array(data.length / 4);
  for (var i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = Math.round(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
  }
  // 直方图均衡化（模拟 CLAHE）
  var hist = new Array(256).fill(0);
  for (var gi = 0; gi < gray.length; gi++) hist[gray[gi]]++;
  var cdf = new Array(256);
  cdf[0] = hist[0];
  for (var ci = 1; ci < 256; ci++) cdf[ci] = cdf[ci-1] + hist[ci];
  var minCdf = cdf[0];
  var total = gray.length;
  for (var hi = 0; hi < 256; hi++) cdf[hi] = Math.round(((cdf[hi] - minCdf) / (total - minCdf)) * 255);
  for (var vi = 0, vj = 0; vi < data.length; vi += 4, vj++) {
    var v = cdf[gray[vj]];
    data[vi] = v; data[vi+1] = v; data[vi+2] = v;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/* ================= OCR ================= */

function ocrCanvas(canvas) {
  if (!global.Tesseract) return Promise.reject(new Error('Tesseract.js 未加载'));
  return global.Tesseract.recognize(canvas, 'chi_sim+eng').then(function(r) { return r.data.text || ''; });
}

/* ================= PDF → 多页文本（对齐 Python max_pages=8） ================= */

function pdfToText(file) {
  return new Promise(function(resolve, reject) {
    if (!global.pdfjsLib) { reject(new Error('PDF.js 未加载')); return; }
    file.arrayBuffer().then(function(buf) {
      global.pdfjsLib.getDocument({data: buf}).promise.then(function(pdf) {
        var numPages = Math.min(pdf.numPages, 8);
        var fullText = '';
        function processPage(i) {
          if (i > numPages) { resolve(fullText.trim()); return; }
          pdf.getPage(i).then(function(page) {
            var viewport = page.getViewport({scale: 2});
            var canvas = document.createElement('canvas');
            canvas.width = viewport.width; canvas.height = viewport.height;
            var ctx = canvas.getContext('2d');
            page.render({canvasContext: ctx, viewport: viewport}).promise.then(function() {
              preprocessCanvas(canvas);
              ocrCanvas(canvas).then(function(text) {
                fullText += '\n' + text;
                processPage(i + 1);
              }).catch(function() { processPage(i + 1); });
            }).catch(function() { processPage(i + 1); });
          }).catch(function() { processPage(i + 1); });
        }
        processPage(1);
      }).catch(reject);
    }).catch(reject);
  });
}

function imageToText(file) {
  return createImageBitmap(file).then(function(img) {
    var canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    preprocessCanvas(canvas);
    return ocrCanvas(canvas);
  });
}

/* ================= 统一入口（对齐 Python smart_extract） ================= */

function extractFromFile(file) {
  return new Promise(function(resolve) {
    var stem = (file.name || '').replace(/\.[^.]+$/, '');
    var ext  = ((file.name || '').split('.').pop() || 'pdf').toLowerCase();

    var text = '';

    function finalize(t) {
      text = t || '';
      var type = detectDocType(text);
      var data;
      if (type === '火车票')       data = extractTrainFields(text, stem);
      else if (type === '合同') data = extractContractFields(text);
      else                          data = extractInvoiceFields(text, stem);

      if (type === '发票') extractSpecialInvoice(text, data);

      // 从文件名补充缺失字段
      if (type === '发票' || type === '住宿费' || type === '打车票') {
        var f = extractFromFilename(stem);
        if (!data.date && f.date) data.date = f.date;
        if (!data.invoice_number && f.invoice_number) data.invoice_number = f.invoice_number;
        if (!data.buyer && f.buyer) data.buyer = f.buyer;
      }

      data._raw_text = text;
      resolve({ data: data, type: type, text: text });
    }

    try {
      if (ext === 'pdf') {
        pdfToText(file).then(function(t) { finalize(t); }).catch(function() { finalize(''); });
      } else if (['jpg','jpeg','png','bmp','tiff','tif','gif'].indexOf(ext) !== -1) {
        imageToText(file).then(function(t) { finalize(t); }).catch(function() { finalize(''); });
      } else if (ext === 'docx' || ext === 'doc') {
        finalize(''); // 浏览器端不解析 docx
      } else {
        imageToText(file).then(function(t) { finalize(t); }).catch(function() { finalize(''); });
      }
    } catch(e) {
      finalize('');
    }
  });
}

/* ================= 暴露到全局 ================= */

global.EX = {
  detectDocType:       detectDocType,
  extractInvoiceFields: extractInvoiceFields,
  extractTrainFields:   extractTrainFields,
  extractContractFields: extractContractFields,
  extractSpecialInvoice: extractSpecialInvoice,
  extractFromFile:       extractFromFile,
  extractFromFilename:   extractFromFilename,
  preprocessCanvas:       preprocessCanvas,
  _normalizeText:        normalizeText,
  _cleanCompany:         cleanCompany
};

})(window);
