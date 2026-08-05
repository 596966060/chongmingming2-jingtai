/**
 * extractors.js
 * 核心抽取逻辑 —— 逐行对齐原始 app.py（0804 完整版）
 *
 * 包含：
 *   - detectDocType()        文档类型判断（火车票 > 合同 > 发票）
 *   - extractInvoiceFields()  发票字段抽取
 *   - extractTrainFields()    火车票字段抽取
 *   - extractContractFields() 合同字段抽取
 *   - extractFromFile()       OCR 入口（PDF 多页拼接 / 图片 / DOCX 降级）
 *   - _extractFromFilename()  从文件名补充字段
 */

/* ================= 工具函数 ================= */

/** 公司名清洗（对齐 Python clean_company） */
function cleanCompany(s) {
  if (!s) return null;
  s = String(s).trim();

  // 截断在另一方标签处
  s = s.split(/(?:销售方|购买方)\s*名称/)[0];

  // 截断在纳税人/地址/开户/电话/监制机关处
  s = s.split(/(?:纳税人|识别号|地址[、，,]|开户|电话|统一社会|监制机关|主管税务)/)[0];

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
  if (/^(?:有限责任?公司|股份有限公司|集团公司|有限公司|责任公司|公司)$/.test(s)) return null;

  // 拒绝发票字段标签词
  const LABEL_WORDS = new Set([
    '名称', '金额', '税额', '地址', '电话', '合计', '税率',
    '备注', '开票人', '识别号', '统一社会', '纳税人', '规格',
    '项目', '单位', '数量', '单价', '备注', '信息'
  ]);
  if (LABEL_WORDS.has(s)) return null;

  // 拒绝政府机关
  if (/税务[局所]|国家税务|地方税务|稽查局|国税局|地税局|财政局|监察局|市场监督|行政管理局|公安局|政府|监制机关|主管税务/.test(s)) return null;

  return s.slice(0, 25);
}

/** 从文件名提取补充字段（对齐 Python _extract_from_filename） */
function extractFromFilename(stem) {
  const r = {};
  if (!stem) return r;
  const parts = stem.split(/[_\-\s]+/);

  for (const p of parts) {
    // 发票号：15-25 位纯数字
    if (/^\d{15,25}$/.test(p)) {
      if (!r.invoice_number) r.invoice_number = p;
    }
    // 日期：8 位紧凑格式，严格校验月日
    const dm = p.match(/^(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/);
    if (dm) {
      const y = parseInt(dm[1], 10);
      const m = parseInt(dm[2], 10);
      const d = parseInt(dm[3], 10);
      if (1 <= m && m <= 12 && 1 <= d && d <= 31) {
        if (!r.date) r.date = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      }
    }
    // 公司名
    if (/[\u4e00-\u9fa5]/.test(p) && p.length >= 4 && p.length <= 20) {
      if (!r.buyer) r.buyer = p;
    }
  }
  return r;
}

/** 日期合法性校验 */
function isValidDate(y, m, d) {
  y = parseInt(y, 10); m = parseInt(m, 10); d = parseInt(d, 10);
  if (y < 1900 || y > 2100) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  return true;
}

/** 金额标准化 */
function normAmount(s) {
  if (!s) return null;
  const cleaned = String(s).replace(/[¥￥,，]/g, '').replace(/元$/g, '').trim();
  const n = parseFloat(cleaned);
  if (isNaN(n) || n <= 0) return null;
  return n.toFixed(2);
}

/* ================= 类型判断（与 app.py 完全一致） ================= */

// 火车票强关键词（对齐 Python _TRAIN_KEYWORDS）
const TRAIN_KEYWORDS = /车次|检票|候车|动车|高铁|火车票|硬卧|软卧|硬座|二等座|一等座|商务座|无座|出发站|到达站|网络购票|铁路电子客票|中国铁路|12306|票价[：:\s]*[¥￥]?\d|列车号|乘车日|席别|始发站|终到站|补票|开车时间|出发时间|铁路客票/;

// 合同关键词
const CONTRACT_PARTY_A = /甲方|买方|委托方|发包方|采购方|招标人/;
const CONTRACT_PARTY_B = /乙方|卖方|承包方|承接方|供货方|中标人/;
const CONTRACT_STRONG  = /本合同|本协议|合同编号|甲乙双双|买卖合同|委托方|发包方|合同金额|合同总额|合同总价|合同价款|价款总额|平等自愿|协商一致|合同协议书|货物采购合同|采购合同|服务合同|工程合同|建设工程合同/;

/** 对齐 Python detect_doc_type() */
export function detectDocType(text) {
  if (!text) return 'invoice';

  // 1. 强火车票关键词（优先级最高）
  if (TRAIN_KEYWORDS.test(text)) return 'train';

  // 2. 合同强关键词
  const hasA = CONTRACT_PARTY_A.test(text);
  const hasB = CONTRACT_PARTY_B.test(text);
  const hasS = CONTRACT_STRONG.test(text);
  if (hasS || (hasA && hasB)) return 'contract';

  // 3. 弱车次号检测（仅在无合同信号时）
  // 对齐 Python _TRAIN_NUMBER_RE（无 \b，显式边界）
  if (/(?<![A-Z\d])([GDTZKCY]\d{1,4})(?!\d)/.test(text)) return 'train';

  return 'invoice';
}

/* ================= 发票字段抽取 ================= */

/**
 * 对齐 Python InvoiceExtractor._extract_fields()
 * 注意：此处为正则版抽取，对应 Python 的"通用正则模式"。
 * Python 里还有 _normalize_text（修复 OCR 拆行），前端 OCR 文本同样需要预处理。
 */
export function extractInvoiceFields(text, stem) {
  const r = {
    date: null,
    invoice_number: null,
    buyer: null,
    supplier: null,
    amount: null,
    tax_free_amount: null,
    tax_amount: null
  };

  if (!text) text = '';

  // ---- 文本预处理（对齐 _normalize_text）----
  text = normalizeText(text);

  // === 日期（对齐 Python date_patterns 优先级）===
  const datePatterns = [
    // 有标签：开票日期/日期 + 年月日
    /(?:开票日期|日期)[：:\s]*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/,
    // 标准年月日
    /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/,
    // ISO
    /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/,
    // 紧凑格式（严格月日校验，避免误匹配发票号）
    /(?<!\d)(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/
  ];
  for (const pat of datePatterns) {
    const m = text.match(pat);
    if (m && isValidDate(m[1], m[2], m[3])) {
      r.date = `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
      break;
    }
  }

  // === 发票号码 ===
  const invPatterns = [
    /(?:发票号|号码)[：:\s]*([A-Z0-9)(]{15,25})/i,
    /(?:发票号|号码)[：:\s]*([0-9)(]{10,25})/,
    /\b[A-Z0-9]{15,25}\b/,
    /\b\d{15,25}\b/
  ];
  for (const pat of invPatterns) {
    const m = text.match(pat);
    if (m) {
      const raw = m[1] || m[0];
      const clean = raw.replace(/[^\dA-Z0-9]/g, '');
      if (clean.length >= 13 && clean.length <= 25) {
        r.invoice_number = clean;
        break;
      }
    }
  }

  // === 购买方（多策略，对齐 Python 策略1+2+3）===
  // 策略1a: 购买方 名称: XXX
  let buyerRaw = text.match(/购买方\s*名称[：:]\s*([^\n]{2,35})/) ||
                 text.match(/(?:购买方|购\s*方|买\s*方)[^\n]{0,30}?[名称][：:]\s*([^\n]{2,35})/);
  // 策略1b: 销售方（先取，后面按出现顺序分配）
  let sellerRaw = text.match(/销售方\s*名称[：:]\s*([^\n]{2,35})/) ||
                 text.match(/(?:销售方|销\s*方|卖\s*方)[^\n]{0,30}?[名称][：:]\s*([^\n]{2,35})/);

  // 策略0: 同行双名称 "名称: A  名称: B"
  const sameLineBoth = text.match(/名称[：:]\s*(.+?)\s{2,}名称[：:]\s*([^\n]+)/);

  // 清理并赋值
  if (buyerRaw)  { const c = cleanCompany(buyerRaw[1]); if (c) r.buyer    = c; }
  if (sellerRaw) { const c = cleanCompany(sellerRaw[1]); if (c) r.supplier = c; }

  // 策略0 回填
  if (sameLineBoth && (!r.buyer || !r.supplier)) {
    const b = cleanCompany(sameLineBoth[1]);
    const s = cleanCompany(sameLineBoth[2]);
    if (b && !r.buyer) r.buyer = b;
    if (s && !r.supplier) r.supplier = s;
  }

  // 策略2: 按出现顺序收集所有"名称:"内容
  if (!r.buyer || !r.supplier) {
    const companyLines = [];
    const namePats = [/名称[：:][ \t]*([^\n]+)/g];
    for (const np of namePats) {
      let mm;
      while ((mm = np.exec(text)) !== null) {
        const c = cleanCompany(mm[1]);
        if (c && !companyLines.includes(c)) companyLines.push(c);
      }
      if (companyLines.length >= 2) break;
    }

    // 策略3: 通用企业词尾识别
    if (companyLines.length < 2) {
      const seen = new Set(companyLines);
      const noBank = text.replace(/^.*(?:开户行|开户银行|银行账号|账号).*$/gm, '');
      const corpRe = /[\u4e00-\u9fa5]{2,}(?:公司|有限|分公司|集团|股份|企业|研究所|医院|学校|协会|中心|院|所|厂|部)/g;
      let cm;
      while ((cm = corpRe.exec(noBank)) !== null) {
        const c = cleanCompany(cm[0]);
        if (c && !seen.has(c)) { seen.add(c); companyLines.push(c); }
      }
    }

    if (!r.buyer    && companyLines.length >= 1) r.buyer    = companyLines[0];
    if (!r.supplier  && companyLines.length >= 2) r.supplier  = companyLines[1];
  }

  // === 价税合计 ===
  const totalPatterns = [
    /价税合计[^0-9\n]{0,10}小写[）)]*\s*[¥￥]?\s*([0-9]{1,10}\.[0-9]{2})/,
    /小写[）)]*\s*[¥￥]?\s*([0-9]{1,10}\.[0-9]{2})/,
    /价税合计[^0-9\n]{0,20}([0-9]{1,10}\.[0-9]{2})/,
    /(?:合计|实付|应付|票价|金额)[：:\s]*[¥￥]?\s*([0-9]{1,6}(?:\.[0-9]{1,2})?)/,
    /[¥￥]\s*([0-9]{1,10}(?:\.[0-9]{1,2})?)/,
    /(?<![0-9])([0-9]{1,10}\.[0-9]{2})(?![0-9])/
  ];
  for (const pat of totalPatterns) {
    const m = text.match(pat);
    if (m) { r.amount = normAmount(m[1]); if (r.amount) break; }
  }

  // === 不含税金额 + 税额 ===
  // 策略1: 合计行两列同行
  const twoNum = text.match(/合计\s*[¥￥]?\s*([0-9]{1,10}\.[0-9]{2})[\s\n]+[¥￥]?\s*([0-9]{1,10}\.[0-9]{2})/);
  if (twoNum) {
    r.tax_free_amount = normAmount(twoNum[1]);
    r.tax_amount      = normAmount(twoNum[2]);
  } else {
    // 带税额标签
    const tm = text.match(/(?:合计税额|税额)[：:\s]*[¥￥]?\s*([0-9]{1,10}\.[0-9]{2})/);
    if (tm) r.tax_amount = normAmount(tm[1]);
    const bm = text.match(/(?:不含税|合计金额)[：:\s]*[¥￥]?\s*([0-9]{1,10}\.[0-9]{2})/);
    if (bm) r.tax_free_amount = normAmount(bm[1]);
  }

  // 策略2: 配对加法推断
  if (r.amount && (!r.tax_free_amount || !r.tax_amount)) {
    const total = parseFloat(r.amount);
    const candidates = [];
    const seen = new Set();
    const allDec = text.match(/\b(\d{1,8}\.\d{2})\b/g) || [];
    for (const m of allDec) {
      const v = parseFloat(m);
      if (Math.abs(v - total) > 0.01 && v > 0 && !seen.has(v)) {
        seen.add(v); candidates.push(v);
      }
    }
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        if (Math.abs(candidates[i] + candidates[j] - total) <= 0.05) {
          const bigger  = Math.max(candidates[i], candidates[j]);
          const smaller = Math.min(candidates[i], candidates[j]);
          if (!r.tax_free_amount) r.tax_free_amount = smaller.toFixed(2);
          if (!r.tax_amount)      r.tax_amount      = (bigger === smaller ? smaller : bigger).toFixed(2);
          // 不含税 >= 税额
          if (parseFloat(r.tax_free_amount) < parseFloat(r.tax_amount)) {
            const t = r.tax_free_amount; r.tax_free_amount = r.tax_amount; r.tax_amount = t;
          }
          i = candidates.length; break;
        }
      }
    }
  }

  // 策略3: 推算
  if (r.amount && r.tax_free_amount && !r.tax_amount) {
    const tax = Math.round((parseFloat(r.amount) - parseFloat(r.tax_free_amount)) * 100) / 100;
    if (tax > 0) r.tax_amount = tax.toFixed(2);
  }
  if (r.amount && r.tax_amount && !r.tax_free_amount) {
    const base = Math.round((parseFloat(r.amount) - parseFloat(r.tax_amount)) * 100) / 100;
    if (base > 0) r.tax_free_amount = base.toFixed(2);
  }

  // === 从文件名补充缺失字段 ===
  const f = extractFromFilename(stem || '');
  if (!r.date)           r.date           = f.date           || null;
  if (!r.invoice_number) r.invoice_number = f.invoice_number || null;
  if (!r.buyer)          r.buyer          = f.buyer          || null;

  return r;
}

/* ================= 火车票字段抽取 ================= */

// 站名黑名单（对齐 Python _STATION_BLACKLIST）
const STATION_BLACKLIST = /^(?:出发站|到达站|始发站|终到站|目的地|经由|中转|检票口|候车|开车)$/;

// 姓名黑名单
const NAME_BLACKLIST = new Set([
  '出发', '到达', '乘坐', '车次', '购票', '旅客', '列车', '中国',
  '铁路', '上海', '北京', '广州', '深圳', '成都', '武汉', '南京',
  '高铁', '动车', '候车', '检票', '开车', '席别', '座位', '票价'
]);

export function extractTrainFields(text, stem) {
  const r = {
    date: null,
    train_number: null,
    from_station: null,
    to_station: null,
    passenger_name: null,
    seat: null,
    seat_type: null,
    price: null,
    depart_time: null
  };

  if (!text) text = '';

  // === 车次（对齐 Python：先标签后正则）===
  const tnLabeled = text.match(/(?:车次|列车号)[：:\s]*([GDTZKCY]\d{1,4})/);
  if (tnLabeled) {
    r.train_number = tnLabeled[1];
  } else {
    const tm = text.match(/(?<![A-Z\d])([GDTZKCY]\d{1,4})(?!\d)/);
    if (tm) r.train_number = tm[1];
  }

  // === 日期（对齐 Python：屏蔽"开票日期"行）===
  // 先去掉"开票日期"行
  const textNoInvoiceDate = text.replace(/开票\s*日\s*期[：:\s]*\d{4}年\d{1,2}月\d{1,2}日/g, '');
  const datePats = [
    /(?:乘车日期|出发日期|乘车日)[：:\s]*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/,
    /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/,
    /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/
  ];
  for (const pat of datePats) {
    const m = textNoInvoiceDate.match(pat);
    if (m && isValidDate(m[1], m[2], m[3])) {
      r.date = `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
      break;
    }
  }

  // === 出发时间 ===
  const tm = text.match(/(?:出发时间|开车时间|发车)[：:\s]*(\d{1,2}:\d{2})/);
  if (tm) r.depart_time = tm[1];
  else {
    const tm2 = text.match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (tm2) r.depart_time = tm2[0].slice(0, 5);
  }

  // === 乘客姓名 ===
  const namePats = [
    /(?:姓名|旅客|购票人|乘客)[：:\s]*([\u4e00-\u9fa5]{2,4})/,
    /([\u4e00-\u9fa5]{2,4})[（(]?(?:居民身份证|身份证|护照)/,
    /([\u4e00-\u9fa5]{2,4})\s*\d{15,18}[Xx]?/,
    /([\u4e00-\u9fa5]{2,4})\s*\*{4,}/,
    /\*{4,}\d+\n([\u4e00-\u9fa5]{2,4})/,
    /([\u4e00-\u9fa5]{2,4})\s*[¥￥]\s*\d/
  ];
  for (const np of namePats) {
    const nm = text.match(np);
    if (nm) {
      const name = nm[1].trim();
      if (!NAME_BLACKLIST.has(name)) {
        r.passenger_name = name;
        break;
      }
    }
  }

  // === 站名清理函数 ===
  function cleanStation(name) {
    if (!name) return '';
    name = name.trim();
    if (STATION_BLACKLIST.test(name)) return '';
    // 去掉末尾"站"（保留内嵌的）
    if (name.endsWith('站') && name.length > 2) name = name.slice(0, -1);
    // 排除乘客姓名
    if (r.passenger_name && name === r.passenger_name) return '';
    return name;
  }

  // === 出发站 / 到达站（多策略）===
  // 策略1a: 明确标签
  const fromLabeled = text.match(/(?:出发站|始发站)[ \t]+([\u4e00-\u9fa5]{2,12})/) ||
                      findLabeledStation(text, /(?:出发站|始发站)/);
  const toLabeled   = text.match(/(?:到达站|终到站|目的地)[ \t]+([\u4e00-\u9fa5]{2,12})/) ||
                      findLabeledStation(text, /(?:到达站|终到站|目的地)/);

  if (fromLabeled) { const s = cleanStation(fromLabeled[1]); if (s) r.from_station = s; }
  if (toLabeled)   { const s = cleanStation(toLabeled[1]);   if (s) r.to_station   = s; }

  // 策略1b: 双栏 "始发站   终到站" 后跟两站名
  if (!r.from_station || !r.to_station) {
    const hdr = text.match(/(?:始发站|出发站)[ \t]+(?:终到站|到达站)/);
    if (hdr) {
      const after = text.slice(hdr.index + hdr[0].length);
      const lines = after.split('\n').slice(0, 5);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^[A-Za-z0-9\s\-]+$/.test(trimmed)) continue;
        const parts = trimmed.match(/[\u4e00-\u9fa5]{2,12}/g);
        if (parts && parts.length >= 2) {
          const f = cleanStation(parts[0]);
          const t = cleanStation(parts[1]);
          if (f && !r.from_station) r.from_station = f;
          if (t && !r.to_station)   r.to_station   = t;
          break;
        }
      }
    }
  }

  // 策略2: 箭头分隔
  if (!r.from_station || !r.to_station) {
    const arrow = text.match(/([\u4e00-\u9fa5]{2,10}(?:站)?)\s*[→➜>—至]\s*([\u4e00-\u9fa5]{2,10}(?:站)?)/);
    if (arrow) {
      const f = cleanStation(arrow[1]);
      const t = cleanStation(arrow[2]);
      if (f && !r.from_station) r.from_station = f;
      if (t && !r.to_station)   r.to_station   = t;
    }
  }

  // 策略3: 方位词后缀
  if (!r.from_station || !r.to_station) {
    const candRe = /[\u4e00-\u9fa5]{2,8}(?:虹桥|高铁|北站|南站|东站|西站)(?:站)?|[\u4e00-\u9fa5]{4,8}(?:南|北|东|西)(?:站)?/g;
    const cands = [];
    const seen = new Set();
    let cm;
    while ((cm = candRe.exec(text)) !== null) {
      const s = cleanStation(cm[0]);
      if (s && !seen.has(s)) { seen.add(s); cands.push(s); }
    }
    if (!r.from_station && cands.length >= 1) r.from_station = cands[0];
    if (!r.to_station   && cands.length >= 2) r.to_station   = cands[1];
  }

  // 最终校验：出发==到达 => 清空出发站
  if (r.from_station && r.to_station && r.from_station === r.to_station) {
    r.from_station = null;
  }

  // === 座位类型 ===
  const SEAT_TYPES = ['商务座', '特等座', '一等座', '二等座', '软卧上', '软卧下', '硬卧上', '硬卧中', '硬卧下', '软卧', '硬卧', '硬座', '无座', '动卧'];
  for (const st of SEAT_TYPES) {
    if (text.includes(st)) { r.seat_type = st; break; }
  }
  if (!r.seat_type) {
    const xi = text.match(/席\s*别[：:\s]*([\u4e00-\u9fa5]{2,5})/);
    if (xi) r.seat_type = xi[1];
  }

  // === 座位号 ===
  const seatPats = [
    /(\d{1,2}\s*车\s*\d{1,2}\s*[A-Fa-f号])/,
    /([A-Fa-f]\d\s*车厢?\s*\d{1,2}\s*号?)/,
    /(\d{1,2}[A-Fa-f]\d?)/
  ];
  for (const sp of seatPats) {
    const sm = text.match(sp);
    if (sm) { r.seat = sm[1].trim(); break; }
  }

  // === 票价 ===
  const pricePats = [
    /(?:票价|价格|金额|票款)[：:\s]*[¥￥]?\s*(\d+\.?\d*)/,
    /[¥￥]\s*(\d+\.?\d*)/,
    /(\d{2,5}\.\d{1,2})\s*元/,
    /合计[：:\s]*[¥￥]?\s*(\d+\.?\d*)/
  ];
  for (const pp of pricePats) {
    const pm = text.match(pp);
    if (pm) { r.price = normAmount(pm[1]); if (r.price) break; }
  }

  // 兜底：最大小数
  if (!r.price) {
    const decs = (text.match(/(?<!\d)(\d{1,5}\.\d{1,2})(?!\d)/g) || [])
      .map(parseFloat).filter(v => v >= 1 && v <= 10000);
    if (decs.length) r.price = Math.max(...decs).toFixed(2);
  }

  // === 从文件名补充车次 ===
  if (stem) {
    const parts = stem.split(/[_\-\s]+/);
    for (const p of parts) {
      const tm = p.match(/^([GDTZKCY]\d{1,4})$/);
      if (tm && !r.train_number) { r.train_number = tm[1]; break; }
    }
  }

  return r;
}

/** 辅助：跨行查找标签后的站名（跳过拼音行） */
function findLabeledStation(text, labelRe) {
  const m = text.match(labelRe);
  if (!m) return null;
  const after = text.slice(m.index + m[0].length);
  const lines = after.split('\n').slice(0, 4);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[A-Za-z0-9\s\-]+$/.test(trimmed)) continue;
    const ch = trimmed.match(/[\u4e00-\u9fa5]{2,12}/);
    if (ch) return ch;
  }
  return null;
}

/* ================= 合同字段抽取 ================= */

export function extractContractFields(text) {
  const r = {
    sign_date: null,
    contract_name: null,
    party_a: null,
    party_b: null,
    amount: null
  };

  if (!text) text = '';
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);

  // === 合同名称 ===
  // 1. 标注字段
  let cn = null;
  for (const line of lines) {
    const m = line.match(/(?:合同名称|协议名称|项目名称)[：:]\s*(.{2,40})/);
    if (m) {
      let name = m[1].replace(/[（(].*?[）)]/g, '').trim();
      if (name.length >= 2) { cn = name.slice(0, 20); break; }
    }
  }
  // 2. 标题行
  if (!cn) {
    for (const line of lines.slice(0, 10)) {
      const clean = line.replace(/[《》【】\[\]（(）)\s]+/g, '');
      if (clean.length > 2 && clean.length <= 20 && /合同|协议书/.test(clean)) {
        if (!['合同', '协议书', '协议', '本合同', '本协议'].includes(clean)) {
          cn = clean; break;
        }
      }
    }
  }
  // 3. 全文最先出现的 "XX合同"
  if (!cn) {
    const m = text.match(/[\u4e00-\u9fff]{2,12}(?:采购合同|服务合同|工程合同|合同|协议书)/);
    if (m) cn = m[0].slice(0, 20);
  }
  r.contract_name = cn;

  // === 签订日期 ===
  const dPats = [
    /(?:签订|签署|签约|合同)\s*[日期时间]*\s*[：:\s]+(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    /于\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/
  ];
  for (const pat of dPats) {
    const m = text.match(pat);
    if (m && isValidDate(m[1], m[2], m[3])) {
      r.sign_date = `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
      break;
    }
  }

  // === 甲方 / 乙方 ===
  function cleanParty(raw) {
    if (!raw) return null;
    let v = raw.replace(/[（(][^）)]{1,8}[）)]/g, '').trim();
    v = v.replace(/\s+/g, '');
    // 截断在对方关键词处
    v = v.split(/甲方|乙方|买方|卖方|承包方|委托方|招标人|中标人/)[0];
    return v.length >= 2 ? v.slice(0, 30) : null;
  }

  const A_KW = /(?:甲方|买方|委托方|发包方|采购方|招标人)/;
  const B_KW = /(?:乙方|卖方|承包方|承接方|供货方|中标人)/;

  for (const line of lines) {
    if (!r.party_a) {
      const m = line.match(new RegExp(A_KW.source + '(?:\\s*单位全称|\\s*名称|\\s*（盖章）|\\s*\\(盖章\\))?\\s*[：:\\s]+([^\\n]{2,35})'));
      if (m) { const c = cleanParty(m[1]); if (c) r.party_a = c; }
    }
    if (!r.party_b) {
      const m = line.match(new RegExp(B_KW.source + '(?:\\s*单位全称|\\s*名称|\\s*（盖章）|\\s*\\(盖章\\))?\\s*[：:\\s]+([^\\n]{2,35})'));
      if (m) { const c = cleanParty(m[1]); if (c) r.party_b = c; }
    }
    if (r.party_a && r.party_b) break;
  }

  // 兜底宽松扫描
  if (!r.party_a) {
    const m = text.match(new RegExp(A_KW.source + '[\\s：:]+([^\\n（(]{2,30})'));
    if (m) r.party_a = cleanParty(m[1]);
  }
  if (!r.party_b) {
    const m = text.match(new RegExp(B_KW.source + '[\\s：:]+([^\\n（(]{2,30})'));
    if (m) r.party_b = cleanParty(m[1]);
  }

  // === 合同金额 ===
  function parseAmount(rawNum, unit) {
    const v = parseFloat(String(rawNum).replace(/[,，]/g, ''));
    if (isNaN(v) || v <= 0) return null;
    let result = v;
    if (unit && /万/.test(unit)) result = v * 10000;
    return result.toFixed(2);
  }

  const amtPats = [
    /(?:合同[总]?[额价款金]|总金额|总价款|合同总价|合同价款|价款总额)[^0-9¥￥]{0,15}[¥￥]?\s*(\d[\d,，]*\.?\d*)\s*(万元|元)?/,
    /人民币\s*[¥￥]?\s*(\d[\d,，]*\.?\d+)\s*(万元|元)?/,
    /[¥￥]\s*(\d[\d,，]*\.?\d+)\s*(万元|元)?/,
    /(\d[\d,，]{1,8}\.?\d*)\s*万元/
  ];
  for (const pat of amtPats) {
    const m = text.match(pat);
    if (m) {
      const unit = m[2] || '';
      const amt = parseAmount(m[1], unit);
      if (amt) { r.amount = amt; break; }
    }
  }

  return r;
}

/* ================= 文本预处理（对齐 _normalize_text） ================= */

function normalizeText(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    let raw = lines[i];
    let stripped = raw.trim();

    if (i + 1 < lines.length) {
      const nxt = lines[i + 1].trim();
      // 下一行是"名称:"
      if (/^[名1l][称称][：:﹕]/.test(nxt)) {
        // 孤立购方标签
        if (/^购(?:买方?|方)?(?:信息)?$/.test(stripped)) {
          out.push('购买方' + nxt);
          i += 2; continue;
        }
        // 孤立销方标签
        if (/^销(?:售方?|方)?(?:信息)?$/.test(stripped)) {
          out.push('销售方' + nxt);
          i += 2; continue;
        }
      }
    }

    // 统一标签
    stripped = stripped.replace(/销货单位名称/, '销售方名称');
    stripped = stripped.replace(/购货单位名称/, '购买方名称');
    stripped = stripped.replace(/销货单位[：:]/, '销售方名称：');
    stripped = stripped.replace(/购货单位[：:]/, '购买方名称：');

    out.push(stripped);
    i++;
  }
  return out.join('\n');
}

/* ================= 特殊发票类型（对齐 _extract_special_invoice） ================= */

export function extractSpecialInvoice(text, result) {
  if (!text) return false;

  // 机动车销售统一发票
  if (/机动车销售统一发票|机动车(?:出售|发票)/.test(text)) {
    result.invoice_type = '机动车发票';
    return false; // 让通用逻辑继续
  }

  // 航空运输电子客票行程单
  if (/航空运输电子客票|行程单|旅客姓名|电子客票/.test(text)) {
    result.invoice_type = '航空行程单';
    const nm = text.match(/旅客姓名[：:\s]+([^\n\s]{2,10})/);
    if (nm) result.buyer = nm[1].trim();
    const dep = text.match(/出发地[：:\s]+([^\n\s]{2,8})/);
    const arr = text.match(/目的地[：:\s]+([^\n\s]{2,8})/);
    if (dep && arr) result.supplier = `${dep[1].trim()}-${arr[1].trim()}`;
    else if (dep) result.supplier = dep[1].trim();
    const pm = text.match(/(?:票价|合计)[：:\s]*[¥￥]?\s*(\d+(?:\.\d{1,2})?)/);
    if (pm) result.amount = normAmount(pm[1]);
    return true;
  }

  // 出租车发票
  if (/出租汽车|出租车发票|计价器/.test(text)) {
    result.invoice_type = '出租车发票';
    const pm = text.match(/(?:金额|合计)[：:\s]*[¥￥]?\s*(\d+(?:\.\d{1,2})?)/);
    if (pm) result.amount = normAmount(pm[1]);
    return true;
  }

  // 定额发票
  if (/定额发票|监制(?:章|机关)/.test(text) && text.length < 400) {
    result.invoice_type = '定额发票';
    const pm = text.match(/[¥￥]?\s*(\d+(?:\.\d{1,2})?)\s*元/);
    if (pm) result.amount = normAmount(pm[1]);
    return true;
  }

  return false;
}

/* ================= OCR 入口 ================= */

/** 图像预处理（对齐 Python _preprocess_image：CLAHE 增强） */
function preprocessCanvas(canvas) {
  // 用 Canvas 2D 做对比度增强（模拟 CLAHE）
  const ctx = canvas.getContext('2d');
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;

  // 转灰度 + 直方图均衡化
  const hist = new Array(256).fill(0);
  const gray = new Uint8Array(data.length / 4);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const g = Math.round(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
    gray[j] = g;
    hist[g]++;
  }
  // 累积分布
  const cdf = new Array(256);
  cdf[0] = hist[0];
  for (let i = 1; i < 256; i++) cdf[i] = cdf[i-1] + hist[i];
  const minCdf = cdf[0];
  const total = gray.length;
  for (let i = 0; i < 256; i++) {
    cdf[i] = Math.round(((cdf[i] - minCdf) / (total - minCdf)) * 255);
  }
  // 应用
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const v = cdf[gray[j]];
    data[i] = v; data[i+1] = v; data[i+2] = v;
  }
  ctx.putImageData(imgData, 0, 0);

  return canvas;
}

async function ocrCanvas(canvas) {
  if (!window.Tesseract) throw new Error('Tesseract.js 未加载');
  const { data: { text } } = await Tesseract.recognize(canvas, 'chi_sim+eng');
  return text || '';
}

/** PDF 转多页文本（对齐 Python：前 8 页拼接） */
async function pdfToText(file, maxPages = 8) {
  if (!window.pdfjsLib) throw new Error('PDF.js 未加载');
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  const numPages = Math.min(pdf.numPages, maxPages);
  let fullText = '';

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    preprocessCanvas(canvas);
    const text = await ocrCanvas(canvas);
    fullText += '\n' + text;
  }
  return fullText.trim();
}

async function imageToText(file) {
  const img = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  preprocessCanvas(canvas);
  return await ocrCanvas(canvas);
}

/**
 * 统一入口（对齐 Python smart_extract）
 * 1. PDF → 多页 OCR（前 8 页）
 * 2. 图片 → 单页 OCR
 * 3. DOCX → 暂不支持（返回空文本，让类型判断走默认）
 * 4. 根据文本判断类型 → 调用对应抽取函数
 * 5. 特殊发票优先处理
 */
export async function extractFromFile(file) {
  const stem = (file.name || '').replace(/\.[^.]+$/, '');
  const ext  = ((file.name || '').split('.').pop() || 'pdf').toLowerCase();

  let text = '';

  try {
    if (ext === 'pdf') {
      text = await pdfToText(file, 8);
    } else if (['jpg', 'jpeg', 'png', 'bmp', 'tiff', 'tif', 'gif'].includes(ext)) {
      text = await imageToText(file);
    } else if (ext === 'docx' || ext === 'doc') {
      text = ''; // 浏览器端不解析 docx
    } else {
      text = await imageToText(file);
    }
  } catch (e) {
    console.error('OCR 失败:', e);
    text = '';
  }

  // 类型判断
  const type = detectDocType(text);

  // 特殊发票优先处理
  const data = (type === 'train')    ? extractTrainFields(text, stem)
              : (type === 'contract') ? extractContractFields(text)
              : extractInvoiceFields(text, stem);

  // 特殊发票类型检测（补充 invoice_type 字段）
  if (type === 'invoice') {
    extractSpecialInvoice(text, data);
  }

  // 从文件名补充缺失字段（发票）
  if (type === 'invoice') {
    const f = extractFromFilename(stem);
    if (!data.date)           data.date           = f.date           || null;
    if (!data.invoice_number) data.invoice_number = f.invoice_number || null;
    if (!data.buyer)          data.buyer          = f.buyer          || null;
  }

  data._raw_text = text;
  return { data, type, text };
}
