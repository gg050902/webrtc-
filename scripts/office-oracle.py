#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/office-oracle.py —— 共享文件渲染内核的「另一个实现」对照器（2026-10-09）

═══════════════════════════════════════════════════════════════════════════════
 ▎为什么要有它（AGENTS 坑 106 / 125 / 126 的正面用法，J1 这一档的地基）
═══════════════════════════════════════════════════════════════════════════════
 我们自己的 OOXML 夹具（scripts/ooxml-fixture.js）是**同一只手**写的：
 它只能覆盖"我想到 Office 还允许这些形状"。而真实 Word/Excel 存出来的文件里
 有一整片我没写过的部件（styles 里的编号定义、numbering 的样式链接、文本框、
 域代码、OMML 公式、docProps、customXml、header/footer、thumbnail…）。
 更关键的是：**bug 恰好长在我没写过的形状上**——
 2026-10-09 用 python-docx 一份 30 秒写出来的文件，当场就让"用列表样式写的列表"
 全部退化成普通段落（圆点与序号没了），而那份形状在我的夹具里根本不存在。

 python-docx / openpyxl 是**另一个实现**，于是它同时当两个角色：
   · 写出来的文件 = 真 Word 形状的**输入**（不是我手写的最小包）；
   · 读回来的结构 = 独立**裁判**（不是我自己的渲染器说了算）。

═══════════════════════════════════════════════════════════════════════════════
 ▎两个角色都要，但**注册进回归的只有产物**
═══════════════════════════════════════════════════════════════════════════════
 回归跑的是 `node`，机器上没有 python 也得能跑。所以：
   · 本脚本 `gen-all` 把产物（rich.docx / rich.xlsx / oracle.json）写进 scripts/fixtures/office/；
   · 产物**跟着仓库走**，`test:fileview` 的 Q 组直接读它们；
   · 想加新形状 → 改本脚本 → `python scripts/office-oracle.py gen-all` → 重跑回归。
 ▎为什么不是"测试里现场调 python"：那会让 Q 组在没 python 的机器上**静默跳过**，
   而"跳过"在报告里和"通过"长得太像（坑 76）。产物进仓库，跑没跑就没有歧义。

⚠️ 这台脚本**只输出结构统计**：段落给"长度 + 前 2 个字"，单元格给"长度"。
   与 review:office 同一条纪律——会议材料里可能有工资表，仪表不许顺手把内容打出来。
   （这里的句子是我编的合成样本，但判据的形状要能原样用到用户的真文件上。）

用法：
  python scripts/office-oracle.py gen-all                 # 写 scripts/fixtures/office/
  python scripts/office-oracle.py gen-all <目录>
  python scripts/office-oracle.py gen-docx  out.docx
  python scripts/office-oracle.py gen-xlsx  out.xlsx
  python scripts/office-oracle.py oracle    in.docx|in.xlsx
"""
import sys
import os
import json
import zipfile

MODE = sys.argv[1] if len(sys.argv) > 1 else ''
ARG = sys.argv[2] if len(sys.argv) > 2 else ''
FIXTURE_DIR = os.path.join('scripts', 'fixtures', 'office')

# 合成句子里的"必须可见/必须不可见"标记（Q 组按这些词断言覆盖，而不是断言整段文字）
MARK_TEXTBOX = '文本框里的字'
MARK_FIELD_RESULT = '域结果三三七'
MARK_FLDSIMPLE = '单域结果九〇九'
MARK_MATH = '伽马除以贝塔'
MARK_INSTR = 'PAGE'                  # 域**指令**：绝不该出现在页面上
MARK_LINK_TEXT = '评审报告外链'
MARK_HEADER = '页眉：公司内部资料'    # 有意不渲染（写进断言，将来改要做成决定而不是漂移）
MARK_DIRECT = '直接写numPr的段落'


def _ns(*prefixes):
    from docx.oxml.ns import nsdecls
    return nsdecls(*prefixes)


def gen_docx(path):
    """写一份"真实 Word 会写的形状"的文档（覆盖 J1 抓出来的每一类缺口）。"""
    from docx import Document
    from docx.shared import Inches, RGBColor
    from docx.opc.constants import RELATIONSHIP_TYPE as RT
    from docx.oxml import parse_xml
    from docx.oxml.ns import qn
    from docx.enum.text import WD_BREAK

    doc = Document()
    doc.add_heading('', level=1)
    doc.paragraphs[-1].add_run('项目评审会议记录')

    p = doc.add_paragraph()
    p.add_run('正常段落：').bold = True
    p.add_run('这是正文，含 ')
    p.add_run('斜体字').italic = True
    r2 = p.add_run('与彩色字')
    r2.font.color.rgb = RGBColor(0xC0, 0x00, 0x00)
    doc.add_paragraph('第二段带**星号**与 `反引号`（纯文本，不该被当成 markdown 解析）。')

    doc.add_heading('二级标题：结论', level=2)
    doc.add_heading('三级标题：细节', level=3)

    # ★ 缺口①：编号来自**样式**（List Number 在 styles.xml 里自带 w:numPr，段落自己不写）
    for t in ['第一项任务', '第二项任务', '第三项任务']:
        doc.add_paragraph(t, style='List Number')
    for t in ['要点甲', '要点乙']:
        doc.add_paragraph(t, style='List Bullet')

    # ★ 缺口②：编号直接写在段落上（Word 点工具栏那条路）——两条路都要认
    direct = doc.add_paragraph(MARK_DIRECT)
    pPr = direct._p.get_or_add_pPr()
    pPr.append(parse_xml('<w:numPr %s><w:ilvl w:val="0"/><w:numId w:val="4"/></w:numPr>' % _ns('w')))

    # 表格：表头 + 一个横向合并（真 Word 表最常见就这一种合并，纵向在 ooxml-fixture 里）
    tb = doc.add_table(rows=3, cols=3)
    tb.style = 'Light Grid Accent 1'
    tb.cell(0, 0).text = '负责人'
    tb.cell(0, 1).text = '事项'
    tb.cell(0, 2).text = '期限'
    tb.cell(1, 0).text = '张三'
    tb.cell(1, 1).text = '压测报告'
    tb.cell(1, 2).text = '下周五'
    tb.cell(2, 0).merge(tb.cell(2, 1)).text = '合并两格的说明'
    tb.cell(2, 2).text = '待定'

    # 图片（走 word/media + a:blip r:embed）
    try:
        from PIL import Image
        import io
        tmp = os.path.join(os.path.dirname(os.path.abspath(path)) or '.', '_oracle_img.png')
        buf = io.BytesIO()
        Image.new('RGB', (120, 60), (10, 120, 200)).save(buf, format='PNG')
        with open(tmp, 'wb') as f:
            f.write(buf.getvalue())
        doc.add_picture(tmp, width=Inches(1.0))
        os.remove(tmp)
    except Exception:
        pass

    # 外链（Word 写 w:hyperlink + rels，TargetMode=External）
    para = doc.add_paragraph()
    rid = para.part.relate_to('https://example.com/report', RT.HYPERLINK, is_external=True)
    para._p.append(parse_xml(
        '<w:hyperlink %s r:id="%s"><w:r><w:t>%s</w:t></w:r></w:hyperlink>'
        % (_ns('w', 'r'), rid, MARK_LINK_TEXT)))

    body = doc.element.body
    # ★ 缺口③：文本框——字不在正文流里，藏在 w:pict/v:shape/v:textbox/w:txbxContent
    body.append(parse_xml(
        '<w:p %s xmlns:v="urn:schemas-microsoft-com:vml">'
        '<w:r><w:pict><v:shape type="#_x0000_t202"><v:textbox><w:txbxContent>'
        '<w:p><w:r><w:t>%s</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>'
        % (_ns('w'), MARK_TEXTBOX)))
    # ★ 缺口④：域（fldChar + instrText）——指令不许上屏，结果必须上屏
    body.append(parse_xml(
        '<w:p %s><w:r><w:fldChar w:fldCharType="begin"/></w:r>'
        '<w:r><w:instrText xml:space="preserve"> %s </w:instrText></w:r>'
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
        '<w:r><w:t>%s</w:t></w:r>'
        '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
        % (_ns('w'), MARK_INSTR, MARK_FIELD_RESULT)))
    # ★ 缺口⑤：fldSimple（老写法的一个壳，里面才是结果）
    body.append(parse_xml(
        '<w:p %s><w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>%s</w:t></w:r></w:fldSimple></w:p>'
        % (_ns('w'), MARK_FLDSIMPLE)))
    # ★ 缺口⑥：公式（OMML：字在 m:t 里，不是 w:t）
    body.append(parse_xml(
        '<w:p %s xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">'
        '<w:r><w:t>公式：</w:t></w:r>'
        '<m:oMath><m:r><m:t>%s</m:t></m:r></m:oMath></w:p>'
        % (_ns('w'), MARK_MATH)))

    # 分页符 + 页眉页脚（真文档几乎必带；我们**有意不**渲染页眉页脚，Q 组钉住这个决定）
    pb = doc.add_paragraph()
    pb.add_run().add_break(WD_BREAK.PAGE)
    sec = doc.sections[0]
    sec.header.paragraphs[0].text = MARK_HEADER + '（不该出现在正文里）'
    sec.footer.paragraphs[0].text = '第 1 页（不该出现在正文里）'

    soft = doc.add_paragraph('带软回车的段落。第一行')
    soft.add_run('第二行').add_break(WD_BREAK.LINE)
    q = doc.add_paragraph('引用样式的段落')
    try:
        q.style = doc.styles['Quote']
    except Exception:
        pass
    doc.save(path)


def gen_xlsx(path):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    wb = Workbook()
    ws = wb.active
    ws.title = '备考计划'
    for col, txt in zip('ABCD', ('阶段', '任务', '日期', '工时')):
        c = ws['%s1' % col]
        c.value = txt
        c.font = Font(bold=True)
        c.fill = PatternFill('solid', fgColor='FFE8C7')
    rows = [
        ('第一章', '计算机网络', '2026-11-01', 6),
        ('第一章', '操作系统', '2026-11-08', 5),
        ('第二章', '数据库设计', '2026-12-01', 8),
    ]
    for i, r in enumerate(rows, start=2):
        for j, v in enumerate(r):
            ws.cell(row=i, column=j + 1, value=v)
    ws['E2'] = '=D2+D3'                    # 公式：openpyxl **不写缓存值** ⇒ 必须留空，不许编数
    ws['D10'] = 45570                      # 数字（General）：不许当日期
    ws['C11'] = 45570
    ws['C11'].number_format = 'yyyy-mm-dd'  # 同一个数 + 日期格式：该当日期
    ws['D11'] = 0.25
    ws['D11'].number_format = '0.00%'       # 百分比格式
    ws['B12'] = 1234.5
    ws['B12'].number_format = '¥#,##0.00'   # 货币格式（格式串里带非数字字面量）
    ws.merge_cells('A6:B6')
    ws['A6'] = '合并单元格的说明'
    wb.create_sheet('空表')
    wb.save(path)


def gen_all(target=FIXTURE_DIR):
    os.makedirs(target, exist_ok=True)
    dpath = os.path.join(target, 'rich.docx')
    xpath = os.path.join(target, 'rich.xlsx')
    gen_docx(dpath)
    gen_xlsx(xpath)
    oracle = {'generatedBy': 'scripts/office-oracle.py',
              'marks': {'textbox': MARK_TEXTBOX, 'fieldResult': MARK_FIELD_RESULT,
                        'fldSimple': MARK_FLDSIMPLE, 'math': MARK_MATH, 'instr': MARK_INSTR,
                        'linkText': MARK_LINK_TEXT, 'header': MARK_HEADER, 'direct': MARK_DIRECT},
              'docx': docx_oracle(dpath), 'xlsx': xlsx_oracle(xpath)}
    with open(os.path.join(target, 'oracle.json'), 'w', encoding='utf-8') as f:
        json.dump(oracle, f, ensure_ascii=False, indent=1)
    return oracle


def docx_oracle(path):
    from docx import Document
    from docx.oxml.ns import qn
    doc = Document(path)
    out = {'paras': [], 'tables': [], 'styles': set(), 'images': 0,
           'numberedByStyle': 0, 'numberedDirect': 0, 'links': 0,
           'has_header': False, 'has_footer': False, 'page_breaks': 0,
           'soft_breaks': 0, 'bold_runs': 0, 'italic_runs': 0,
           'total_chars': 0, 'instr': [], 'textbox_paras': 0, 'math_runs': 0,
           'fld_simple': 0, 'styles_with_num': [], 'parts': []}
    try:
        out['parts'] = sorted(zipfile.ZipFile(path).namelist())
    except Exception:
        pass
    body = doc.element.body
    out['images'] = len([e for e in body.iter() if e.tag.endswith('}blip')])
    out['links'] = len([e for e in body.iter() if e.tag.endswith('}hyperlink')])
    out['instr'] = [(e.text or '').strip() for e in body.iter() if e.tag.endswith('}instrText')]
    out['textbox_paras'] = len([e for e in body.iter() if e.tag.endswith('}txbxContent') and len(e) > 0])
    out['math_runs'] = len([e for e in body.iter() if e.tag.endswith('}oMath')])
    out['fld_simple'] = len([e for e in body.iter() if e.tag.endswith('}fldSimple')])
    for e in body.iter():
        if e.tag.endswith('}br'):
            if e.get(qn('w:type')) == 'page':
                out['page_breaks'] += 1
            else:
                out['soft_breaks'] += 1
    # 样式表里"哪些段落样式自带编号"——这正是缺口①的独立判据（不依赖我的渲染器）
    style_has_num = set()
    try:
        sroot = doc.styles.element
        for st in sroot.findall(qn('w:style')):
            sid = st.get(qn('w:styleId')) or ''
            pp = st.find(qn('w:pPr'))
            if pp is not None and pp.find(qn('w:numPr')) is not None:
                style_has_num.add(sid)
    except Exception:
        pass
    out['styles_with_num'] = sorted(style_has_num)
    for p in doc.paragraphs:
        txt = p.text or ''
        style = (p.style.name if p.style is not None else '') or ''
        sid = (p.style.style_id if p.style is not None else '') or ''
        out['total_chars'] += len(txt)
        direct = bool(p._p.findall('.//' + qn('w:numPr')))
        by_style = (not direct) and sid in style_has_num
        if direct:
            out['numberedDirect'] += 1
        elif by_style:
            out['numberedByStyle'] += 1
        for r in p.runs:
            if r.bold:
                out['bold_runs'] += 1
            if r.italic:
                out['italic_runs'] += 1
        out['paras'].append({'text_len': len(txt), 'head': txt[:2], 'style': style,
                            'style_id': sid, 'num_direct': direct, 'num_by_style': by_style})
        out['styles'].add(style)
    for t in doc.tables:
        out['tables'].append({'rows': len(t.rows), 'cols': len(t.columns),
                             'cell_lens': [[len(c.text or '') for c in row.cells] for row in t.rows]})
    for s in doc.sections:
        if s.header is not None and any((p.text or '').strip() for p in s.header.paragraphs):
            out['has_header'] = True
        if s.footer is not None and any((p.text or '').strip() for p in s.footer.paragraphs):
            out['has_footer'] = True
    out['styles'] = sorted(out['styles'])
    return out


def xlsx_oracle(path):
    from openpyxl import load_workbook
    wb = load_workbook(path, data_only=False)
    wbv = load_workbook(path, data_only=True)   # 缓存值视图：公式在这里是 None（openpyxl 不重算）
    out = {'sheets': [], 'total_chars': 0, 'merged': 0, 'formulas': [], 'dates': [],
           'numbers': [], 'percents': [], 'currency': [], 'text_cells': 0, 'sheet_count': 0}
    for name in wb.sheetnames:
        ws = wb[name]
        wsv = wbv[name]
        cells = []
        for row in ws.iter_rows():
            for c in row:
                if c.value is None:
                    continue
                nf = c.number_format or ''
                v = wsv.cell(row=c.row, column=c.column).value
                rec = {'r': c.row, 'c': c.column, 'len': len(str(c.value)),
                       'cached': None if v is None else str(v), 'fmt': nf}
                if isinstance(c.value, str) and c.value.startswith('='):
                    rec['k'] = 'formula'
                    out['formulas'].append(rec)
                elif hasattr(c.value, 'year') and hasattr(c.value, 'month'):
                    # openpyxl 3.x 会把 '2026-11-01' 这种字符串**自动认成日期**存进文件
                    # （存成序列号 + 日期格式）——真 Excel 也是这么存的，所以这条正好是我们要的形状
                    rec['k'] = 'date'
                    out['dates'].append(rec)
                elif isinstance(c.value, (int, float)):
                    has_time = any(x in nf for x in ('h:', 'mm:', 's:'))
                    is_date = ('General' not in nf) and any(x in nf for x in ('yy', 'mmm', 'dd')) and not has_time
                    if is_date:
                        rec['k'] = 'date'
                        out['dates'].append(rec)
                    elif '%' in nf:
                        rec['k'] = 'percent'
                        out['percents'].append(rec)
                    elif any(x in nf for x in ('¥', '$')):
                        rec['k'] = 'currency'
                        out['currency'].append(rec)
                    else:
                        rec['k'] = 'number'
                        out['numbers'].append(rec)
                else:
                    rec['k'] = 'text'
                    out['text_cells'] += 1
                    out['total_chars'] += len(c.value)
                cells.append(rec)
        out['sheets'].append({'cells': cells})
    for name in wb.sheetnames:
        out['merged'] += len(wb[name].merged_cells.ranges)
    out['sheet_count'] = len(wb.sheetnames)
    return out


def main():
    if MODE == 'gen-docx':
        gen_docx(ARG); print('generated', ARG); return
    if MODE == 'gen-xlsx':
        gen_xlsx(ARG); print('generated', ARG); return
    if MODE == 'gen-all':
        o = gen_all(ARG or FIXTURE_DIR)
        d = o['docx']
        print('generated ->', ARG or FIXTURE_DIR)
        print('docx: 段落 %d（编号来自样式 %d、直接 %d）· 表 %d · 图 %d · 链接 %d · 文本框 %d · 公式 %d · 单域 %d · 部件 %d'
              % (len(d['paras']), d['numberedByStyle'], d['numberedDirect'], len(d['tables']),
                 d['images'], d['links'], d['textbox_paras'], d['math_runs'], d['fld_simple'], len(d['parts'])))
        x = o['xlsx']
        print('xlsx: 表 %d · 公式 %d · 日期 %d · 百分比 %d · 货币 %d · 合并 %d'
              % (x['sheet_count'], len(x['formulas']), len(x['dates']), len(x['percents']),
                 len(x['currency']), x['merged']))
        return
    if MODE == 'oracle':
        ext = os.path.splitext(ARG)[1].lower()
        o = docx_oracle(ARG) if ext == '.docx' else xlsx_oracle(ARG)
        print(json.dumps(o, ensure_ascii=False))
        return
    print(__doc__)


if __name__ == '__main__':
    main()
