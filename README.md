# 发票 / 火车票 / 合同 批量重命名工具（纯前端版）

## 功能
- 拖拽上传或点击选择 PDF / 图片 / DOCX 文件
- 自动识别文档类型（发票 / 火车票 / 合同）
- 按规则自动重命名（**完全对齐原版 Python app.py 0804**）：
  - 发票：`日期_销售方_购买方_金额元.ext`
  - 火车票：`日期_出发站-到达站_票价元.ext`
  - 合同：`签订日期_合同名称_甲方关键字_乙方关键字_金额元.ext`
- 手动点击编辑文件名 / 字段，实时刷新
- 批量导出 ZIP / CSV（23 列，带 BOM）/ Excel
- 可选"高精度模式"（调用后端 EasyOCR 补刀）

## 命名规则细节（与 Python 版 1:1）

| 项目 | 规则 |
|---|---|
| 日期格式 | `YYYY-MM-DD`，无法识别时为 `0000-01-01` |
| 公司名截取 | 发票：前 20 字；合同方：去括号→去企业后缀→前 6 字 |
| 金额 | 永远保留两位小数 + "元" 后缀 |
| 非法字符 | `\/:*?"<>|` 全部清洗 |
| 连续下划线 | 合并为单个 |

## 部署（Cloudflare Pages）

1. 把仓库连接到 Cloudflare Pages（Git 模式）
2. Framework preset: **None**
3. Build command: `exit 0`
4. Output directory: `/`
5. Production branch: `main`
6. Deploy → 获得 `xxx.pages.dev` 永久免费地址

## 高精度后端（可选）

1. 在 Replit 创建 Python 项目
2. 上传 `high_precision_server.py`
3. 安装依赖：`pip install flask easyocr pillow numpy opencv-python-headless pymupdf pdf2image`
4. 启动后复制地址
5. 在网页勾选"高精度模式"并粘贴地址

## 文件说明

| 文件 | 作用 |
|---|---|
| `index.html` | 页面结构 + 第三方库引入 |
| `styles.css` | 完整样式（拖拽区/表格/弹窗/Toast） |
| `app.js` | 主逻辑（拖拽/进度/编辑/按钮/统计） |
| `extractors.js` | 核心抽取（发票/火车票/合同正则，对齐 Python） |
| `filenames.js` | 命名规则（发票/火车票/合同 1:1 翻译） |
| `export.js` | ZIP / CSV（23列）/ Excel 导出 |
| `highPrecision.js` | 高精度模式前端桥接 |
| `high_precision_server.py` | 高精度后端（EasyOCR） |
