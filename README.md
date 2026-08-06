# 发票 / 火车票 / 合同 批量重命名（纯前端版）

对齐原始 `app.py`（0804 完整版）的命名规则与抽取逻辑，纯浏览器端运行，零后端。

## 文件清单

| 文件 | 作用 |
|---|---|
| `index.html` | 页面结构 + 第三方库引入 |
| `styles.css` | 完整样式（拖拽/表格/弹窗/Toast） |
| `app.js` | 主控制流（选择→识别→命名→导出） |
| `extractors.js` | 核心抽取（发票/火车票/合同） |
| `filenames.js` | 命名规则（与 Python 1:1） |
| `export.js` | CSV 23列 + Excel 彩色导出 |
| `highPrecision.js` | 高精度后端桥接（可选） |
| `high_precision_server.py` | Python EasyOCR 后端（可选） |

## 命名规则（与 Python 完全一致）

| 类型 | 格式 | 示例 |
|---|---|---|
| 发票 | `日期_销售方_购买方_金额元.ext` | `2025-06-08_松鼠创科_广德公司_265.35元.pdf` |
| 火车票 | `日期_出发站-到达站_票价元.ext` | `2025-07-27_上海虹桥-北京南_553.00元.pdf` |
| 合同 | `签订日期_合同名_甲方_乙方_金额元.ext` | `2025-01-15_采购合同_腾讯_阿里_50000元.docx` |

## 部署到 Cloudflare Pages

1. 把这 8 个文件上传到 GitHub 仓库根目录
2. Cloudflare Pages → Connect to Git → 选仓库
3. 配置：`Framework preset: None`，`Build command: exit 0`，`Output dir: /`
4. 部署完成后访问 `xxx.pages.dev`

## 使用

- 点击 **选择文件** 或 **拖拽文件到蓝色虚线框**
- 等待 OCR 识别完成（首次约 5 秒加载 Tesseract.js）
- 点击新文件名可手动编辑
- 点 **下载 ZIP / CSV / Excel** 导出

## 高精度模式（可选）

在 Replit / 服务器上运行 `high_precision_server.py`，将地址粘贴到页面输入框，勾选"高精度模式"即可让后端 EasyOCR 补刀前端识别不全的字段。

## 支持格式

PDF、JPG、PNG、BMP、TIFF、DOCX（docx 仅走文件名补充逻辑，建议用高精度模式）

## 技术栈

- Tesseract.js（OCR）
- PDF.js（PDF 渲染）
- JSZip（ZIP 打包）
- SheetJS（Excel 导出）
- 纯原生 JS（无框架依赖）
