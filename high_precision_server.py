"""
high_precision_server.py
高精度 OCR 后端 —— 部署到 Replit / 任意 Python 服务器
供前端"高精度模式"调用

接口:
  POST /api/extract  { file: <File> }  (multipart/form-data)
  → { "type": "invoice", "text": "...", "fields": {...} }

  GET  /health → { "status": "ok" }
"""

import base64
import io
import re
import sys
import os

from flask import Flask, request, jsonify

app = Flask(__name__)

# ===== 延迟加载 EasyOCR（首次请求时加载，启动快） =====
_reader = None

def get_reader():
    global _reader
    if _reader is None:
        import easyocr
        _reader = easyocr.Reader(['ch_sim', 'en'], gpu=False)
    return _reader


# ===== 工具函数 =====

def clean_company(s):
    if not s:
        return None
    s = re.sub(r'[（(][^）)]*[）)]', '', s).strip()
    if not re.search(r'[\u4e00-\u9fa5]', s):
        return None
    if len(s) < 2:
        return None
    if re.match(r'^(有限公司|公司|有限责任公司|股份|集团)$', s):
        return None
    return s[:25]


def abbr_company(name):
    if not name:
        return ''
    s = re.sub(r'[（(][^）)]{1,10}[）)]', '', name).strip()
    s = re.sub(r'\s+', '', s)
    sfx = ['有限责任公司', '股份有限公司', '集团有限公司', '总公司', '分公司', '有限公司', '集团']
    for x in sfx:
        if s.endswith(x):
            s = s[:-len(x)]
            break
    s = re.sub(r'[（(].*$', '', s).strip()
    if len(s) > 6:
        s = s[:6]
    return s


def abbr_place(name):
    if not name:
        return ''
    s = re.sub(r'\s+', '', name).strip()
    sfx = ['市', '区', '县', '站', '机场', '高铁站', '火车站']
    for x in sfx:
        if s.endswith(x) and len(s) > 2:
            s = s[:-len(x)]
            break
    if len(s) > 4:
        s = s[:4]
    return s


def extract_from_filename(stem):
    r = {}
    if not stem:
        return r
    parts = re.split(r'[_\-\s\.]+', stem)
    for p in parts:
        if re.match(r'^\d{15,25}$', p):
            r['invoice_number'] = p
        m = re.match(r'^(20\d{2})(\d{2})(\d{2})', p)
        if m:
            r['date'] = f'{m.group(1)}-{m.group(2)}-{m.group(3)}'
        if re.search(r'[\u4e00-\u9fa5]', p) and 4 <= len(p) <= 20:
            if 'buyer' not in r:
                r['buyer'] = p
            elif 'supplier' not in r and p != r.get('buyer'):
                r['supplier'] = p
    return r


def detect_doc_type(text):
    if not text:
        return '发票'

    # T3出行/网约车（优先级最高）
    if re.search(r'T3出行|滴滴|滴滴出行|曹操出行|高德打车|美团打车|网约车|打车.*发票|出租汽车.*发票', text):
        return '打车票'

    # 飞机票
    if re.search(r'航空运输电子客票|行程单|旅客姓名|电子客票|登机牌|航班|机票|飞猪|携程.*机票|airline|flight', text, re.I):
        return '飞机票'

    # 火车票
    if re.search(r'车次|高铁|动车|火车票|二等座|一等座|出发站|到达站|票价|中国铁路|列车号|检票|候车|硬卧|软卧|硬座|商务座|无座|网络购票|铁路电子客票|12306|席别|始发站|终到站|补票|开车时间|出发时间|铁路客票', text):
        return '火车票'

    # 住宿
    if re.search(r'住宿|宾馆|酒店|旅店|入住|如家|汉庭|全季|民宿|客房|房费', text):
        return '住宿费'

    # 合同
    has_a = re.search(r'甲方|买方|委托方|发包方|采购方|需方|招标人', text)
    has_b = re.search(r'乙方|卖方|承包方|承接方|供货方|供方|中标人', text)
    has_s = re.search(r'本合同|本协议|合同编号|合同金额|平等自愿|协商一致|合同协议书|货物采购合同|采购合同|服务合同|工程合同|建设工程合同', text)
    if has_s or (has_a and has_b):
        return '合同'

    # 弱车次号检测
    if re.search(r'(?<![A-Z\d])([GDTZKCY]\d{1,4})(?!\d)', text):
        return '火车票'

    return '发票'


def extract_invoice(text, stem=''):
    r = {'date': None, 'invoice_number': None, 'buyer': None,
          'supplier': None, 'amount': None, 'tax_free_amount': None, 'tax_amount': None,
          'invoice_type': None, 'place': None, 'from_station': None, 'to_station': None}
    if not text:
        text = ''

    # 日期
    for pat in [
        r'(?:开票日期|日期|开具日期)[：:\s]*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})',
        r'(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日',
        r'(\d{4})[-/](\d{1,2})[-/](\d{1,2})',
    ]:
        m = re.search(pat, text)
        if m:
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if 2000 <= y <= 2030 and 1 <= mo <= 12 and 1 <= d <= 31:
                r['date'] = f'{y}-{mo:02d}-{d:02d}'
                break

    # 发票号
    for pat in [
        r'(?:发票号|号码|发票号码|No\.?)[：:\s]*([A-Z0-9]{8,25})',
        r'(?:发票代码|代码)[：:\s]*(\d{8,12})',
        r'\b(\d{20})\b',
        r'\b(\d{15,25})\b',
    ]:
        m = re.search(pat, text)
        if m:
            r['invoice_number'] = m.group(1)
            break

    # 购买方
    for pat in [
        r'购买方\s*(?:名称)?[：:]\s*([^\n（(]{2,30})',
        r'买方[：:]\s*([^\n（(]{2,30})',
        r'(?:名称|单位)[：:]\s*([\u4e00-\u9fa5（）()\w\s]{2,30})',
    ]:
        m = re.search(pat, text)
        if m:
            c = clean_company(m.group(1))
            if c:
                r['buyer'] = c
                break

    # 销售方
    for pat in [
        r'销售方\s*(?:名称)?[：:]\s*([^\n（(]{2,30})',
        r'卖方[：:]\s*([^\n（(]{2,30})',
        r'(?:服务提供方|开票方)[：:]\s*([^\n（(]{2,30})',
    ]:
        m = re.search(pat, text)
        if m:
            c = clean_company(m.group(1))
            if c:
                r['supplier'] = c
                break

    # 金额
    for pat in [
        r'价税合计[^\d]*[¥￥]?\s*(\d+\.\d{2})',
        r'合计[^\d]*[¥￥]?\s*(\d+\.\d{2})',
        r'[¥￥]\s*(\d+\.\d{2})\s*(?:元)?\s*$',
        r'(\d+\.\d{2})\s*元',
    ]:
        m = re.search(pat, text)
        if m:
            try:
                r['amount'] = f"{float(m.group(1)):.2f}"
                break
            except ValueError:
                pass

    # 不含税
    for pat in [
        r'(?:不含税|金额)[^\d]*[¥￥]?\s*(\d+\.\d{2})',
        r'小写[：:]\s*[¥￥]?\s*(\d+\.\d{2})',
    ]:
        m = re.search(pat, text)
        if m:
            try:
                r['tax_free_amount'] = f"{float(m.group(1)):.2f}"
                break
            except ValueError:
                pass

    # 税额
    for pat in [
        r'税额[：:\s]*[¥￥]?\s*(\d+\.\d{2})',
        r'税\s*额[：:\s]*[¥￥]?\s*(\d+\.\d{2})',
    ]:
        m = re.search(pat, text)
        if m:
            try:
                r['tax_amount'] = f"{float(m.group(1)):.2f}"
                break
            except ValueError:
                pass

    # 从文件名补
    f = extract_from_filename(stem)
    if not r['date']:
        r['date'] = f.get('date')
    if not r['invoice_number']:
        r['invoice_number'] = f.get('invoice_number')
    if not r['buyer']:
        r['buyer'] = f.get('buyer')
    if not r['supplier']:
        r['supplier'] = f.get('supplier')

    return r


def extract_train(text, stem=''):
    r = {'date': None, 'train_number': None, 'from_station': None,
         'to_station': None, 'passenger_name': None, 'seat_type': None, 'price': None}
    if not text:
        text = ''

    m = re.search(r'(?:车次|列车号|车号)[：:\s]*([GDCZTKY]\d{1,5})', text)
    if not m:
        m = re.search(r'\b([GDCZTKY]\d{1,5})\b', text)
    if m:
        r['train_number'] = m.group(1)

    for pat in [
        r'(?:乘车日期|出发日期|日期)[：:\s]*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})',
        r'(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日',
        r'(\d{4})[-/](\d{1,2})[-/](\d{1,2})',
    ]:
        m = re.search(pat, text)
        if m:
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if 2000 <= y <= 2030 and 1 <= mo <= 12 and 1 <= d <= 31:
                r['date'] = f'{y}-{mo:02d}-{d:02d}'
                break

    m = re.search(r'(?:出发站|始发站|从)[：:\s]*([\u4e00-\u9fa5]{2,8}站?)', text)
    if m:
        r['from_station'] = m.group(1).rstrip('站') if len(m.group(1)) > 2 else m.group(1)

    m = re.search(r'(?:到达站|终到站|到|目的地)[：:\s]*([\u4e00-\u9fa5]{2,8}站?)', text)
    if m:
        r['to_station'] = m.group(1).rstrip('站') if len(m.group(1)) > 2 else m.group(1)

    m = re.search(r'[¥￥]\s*(\d+\.\d{2})', text)
    if not m:
        m = re.search(r'票价[：:\s]*(\d+\.\d{2})', text)
    if not m:
        m = re.search(r'(\d+\.\d{2})\s*元', text)
    if m:
        try:
            r['price'] = f"{float(m.group(1)):.2f}"
        except ValueError:
            pass

    return r


def extract_t3(text, stem=''):
    """T3出行/网约车字段抽取"""
    r = {'date': None, 'from_station': None, 'to_station': None, 'amount': None, 'supplier': 'T3出行'}
    if not text:
        text = ''

    # 日期
    for pat in [
        r'(?:出行日期|乘车日期|日期)[：:\s]*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})',
        r'(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日',
        r'(\d{4})[-/](\d{1,2})[-/](\d{1,2})',
    ]:
        m = re.search(pat, text)
        if m:
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if 2000 <= y <= 2030 and 1 <= mo <= 12 and 1 <= d <= 31:
                r['date'] = f'{y}-{mo:02d}-{d:02d}'
                break

    # 出发地/到达地
    m = re.search(r'(?:出发|起点|上车地点|起始)[：:\s]*([^\n]{2,10})', text)
    if m:
        r['from_station'] = m.group(1).strip()[:10]

    m = re.search(r'(?:到达|终点|下车地点|目的)[：:\s]*([^\n]{2,10})', text)
    if m:
        r['to_station'] = m.group(1).strip()[:10]

    # 金额
    for pat in [
        r'(?:金额|合计|车费)[：:\s]*[¥￥]?\s*(\d+\.\d{2})',
        r'[¥￥]\s*(\d+\.\d{2})',
        r'(\d+\.\d{2})\s*元',
    ]:
        m = re.search(pat, text)
        if m:
            try:
                r['amount'] = f"{float(m.group(1)):.2f}"
                break
            except ValueError:
                pass

    return r


def extract_contract(text):
    r = {'sign_date': None, 'contract_name': None,
         'party_a': None, 'party_b': None, 'amount': None}
    if not text:
        text = ''

    for pat in [
        r'(?:签订|签署|签约|订立).*?(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})',
        r'(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日',
        r'(\d{4})[-/](\d{1,2})[-/](\d{1,2})',
    ]:
        m = re.search(pat, text)
        if m:
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if 2000 <= y <= 2030 and 1 <= mo <= 12 and 1 <= d <= 31:
                r['sign_date'] = f'{y}-{mo:02d}-{d:02d}'
                break

    m = re.search(r'(?:合同名称|协议名称|项目名称)[：:\s]*([^\n]{2,25})', text)
    if not m:
        m = re.search(r'([^\n]{2,15}(?:服务合同|采购合同|销售合同|劳动合同|租赁|协议|协议书))', text)
    if m:
        r['contract_name'] = m.group(1).strip()[:20]

    m = re.search(r'(?:甲方|买方|需方|采购方)[：:\s]*([^\n（(]{2,25})', text)
    if m:
        r['party_a'] = clean_company(m.group(1))

    m = re.search(r'(?:乙方|卖方|供方|供货方)[：:\s]*([^\n（(]{2,25})', text)
    if m:
        r['party_b'] = clean_company(m.group(1))

    m = re.search(r'(?:合同金额|总金额|总价|金额)[：:\s]*[¥￥]?\s*(\d[\d,]*\.?\d*)', text)
    if not m:
        m = re.search(r'[¥￥]\s*(\d[\d,]*\.?\d*)', text)
    if m:
        try:
            r['amount'] = f"{float(m.group(1).replace(',', '')):.2f}"
        except ValueError:
            pass

    return r


# ===== OCR 函数 =====

def ocr_with_easyocr(image_bytes):
    """用 EasyOCR 识别图片字节"""
    import numpy as np
    from PIL import Image
    import cv2

    reader = get_reader()
    img = Image.open(io.BytesIO(image_bytes)).convert('RGB')
    arr = np.array(img)

    # 增强对比度
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    enhanced_rgb = cv2.cvtColor(enhanced, cv2.COLOR_GRAY2RGB)

    result = reader.readtext(enhanced_rgb, detail=0, paragraph=True)
    return '\n'.join(result)


def pdf_to_text(pdf_bytes, max_pages=8):
    """PDF → 多页文本拼接"""
    import fitz  # PyMuPDF

    doc = fitz.open(stream=pdf_bytes, filetype='pdf')
    texts = []
    for i, page in enumerate(doc):
        if i >= max_pages:
            break
        pix = page.get_pixmap(dpi=150)
        img_bytes = pix.tobytes('png')
        text = ocr_with_easyocr(img_bytes)
        texts.append(text)
    doc.close()
    return '\n'.join(texts)


def docx_to_text(docx_bytes):
    """DOCX → 文本（python-docx）"""
    import docx
    doc = docx.Document(io.BytesIO(docx_bytes))
    texts = []
    for para in doc.paragraphs:
        if para.text.strip():
            texts.append(para.text.strip())
    return '\n'.join(texts)


# ===== Flask 路由 =====

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})


@app.route('/api/extract', methods=['POST'])
def api_extract():
    try:
        # 支持两种格式：JSON (base64) 或 multipart/form-data
        if request.content_type and 'multipart' in request.content_type:
            file = request.files.get('file')
            if not file:
                return jsonify({'error': '缺少 file 字段'}), 400
            filename = file.filename
            raw = file.read()
        else:
            data = request.get_json(force=True)
            filename = data.get('filename', '')
            content_b64 = data.get('content_b64', '')
            if not content_b64:
                return jsonify({'error': '缺少 content_b64'}), 400
            raw = base64.b64decode(content_b64)

        # 判断类型并 OCR
        lower = filename.lower()
        if lower.endswith('.pdf'):
            text = pdf_to_text(raw, max_pages=8)
        elif lower.endswith('.docx') or lower.endswith('.doc'):
            text = docx_to_text(raw)
        else:
            text = ocr_with_easyocr(raw)

        if not text or len(text.strip()) < 5:
            return jsonify({
                'type': '发票',
                'text': '',
                'fields': {},
                'warning': 'OCR 未提取到有效文本'
            })

        # 抽取字段
        stem = re.sub(r'\.[^.]+$', '', filename)
        doc_type = detect_doc_type(text)

        if doc_type == '火车票':
            fields = extract_train(text, stem)
        elif doc_type == '打车票':
            fields = extract_t3(text, stem)
        elif doc_type == '合同':
            fields = extract_contract(text)
        else:
            fields = extract_invoice(text, stem)

        return jsonify({
            'type': doc_type,
            'text': text[:2000],
            'fields': fields
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ===== 启动 =====

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
