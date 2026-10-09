# scripts/legacy-oracle.ps1 —— 用**真的 Microsoft Office** 生成旧格式夹具 + 抽出真值
#
# ▎为什么走这条路（2026-10-09，J2）：
#   旧版 .doc/.xls/.ppt 是**二进制复合文档**（OLE2/CFB），零依赖要读它，
#   就必须有自己的 CFB 读取器 + Word97 piece table + BIFF8 记录遍历。
#   这种代码的失败方式全是静默的：偏移错 4 个字节，抽出来的就是"看着像话的乱码"。
#   ▸ 所以判据不能来自我自己写的东西，只能来自**造这个文件的程序本身**：
#     Word 说它自己文档里有什么字（Content.Text），我的抽取器就得还原出这些字。
#     这一台脚本做两件事：① 生成 legacy.doc / legacy.xls / legacy.ppt；
#     ② 把 Office 自己读到的文字写成 oracle.json（结构 + 若干"必须出现的句子"标记）。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/legacy-oracle.ps1
#
# ⚠️ 全部句子是我现编的合成样本（不是用户的会议材料）；产物进仓库当回归夹具。
#    需要本机装有 Word/Excel/PowerPoint（COM）；没有就退回 review:office 的真文件回扫。

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'scripts\fixtures\office\legacy'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function NoAlerts($app) {
  try { $app.DisplayAlerts = 0 } catch { }
}

# ───────────────────────── Word：.doc（Word 97-2003）─────────────────────────
$w = New-Object -ComObject Word.Application
$w.Visible = $false
NoAlerts $w
$doc = $w.Documents.Add()
$sel = $w.Selection

$marks = @{}

# 标题 + 正文（真 Word 用样式写标题，样式信息就存在 FIB/样式表里）
$sel.Style = $doc.Styles.Item([object](-2))      # wdStyleHeading1
$sel.TypeText('旧格式回归样本')
$sel.Style = $doc.Styles.Item([object](-1))      # wdStyleNormal
$sel.TypeText([char]13)
$sel.TypeText('第一段：共享文件与旧格式')
$sel.TypeText([char]13)
$sel.TypeText('第二段：KX71 标记 ALPHA-9 与 3.14159')
$sel.TypeText([char]13)
$marks['para1'] = '第一段：共享文件与旧格式'
$marks['para2'] = '第二段：KX71 标记 ALPHA-9 与 3.14159'

# 编号列表（Word 用 ListFormat 直接写 numPr 进段落）
$sel.Range.ListFormat.ApplyNumberDefault()
$sel.TypeText('编号项甲')
$sel.TypeText([char]13)
$sel.TypeText('编号项乙')
$sel.TypeText([char]13)
$sel.Range.ListFormat.RemoveNumbers()
$marks['list1'] = '编号项甲'
$marks['list2'] = '编号项乙'

# 表格
$tbl = $doc.Tables.Add($sel.Range, 2, 3)
$tbl.Cell(1, 1).Range.Text = '负责人'
$tbl.Cell(1, 2).Range.Text = '事项'
$tbl.Cell(1, 3).Range.Text = '期限'
$tbl.Cell(2, 1).Range.Text = '李四'
$tbl.Cell(2, 2).Range.Text = '跨网验收'
$tbl.Cell(2, 3).Range.Text = '下周三'
$sel.EndKey(6) | Out-Null
$sel.TypeText([char]13)
$marks['tableCell'] = '跨网验收'

# 文本框（旧格式里是 drawing object，文字存在另一条流里 —— 最难的一类）
$shp = $doc.Shapes.AddTextbox(1, 40, 40, 200, 60)   # msoTextOrientationHorizontal
$shp.TextFrame.TextRange.Text = '文本框里的字QZ3'
$marks['textbox'] = '文本框里的字QZ3'
$sel.EndKey(6) | Out-Null
$sel.TypeText([char]13)
# 页码域（域指令不能当正文）
$w.Selection.InsertBreak(7)
$w.Selection.Fields.Add($w.Selection.Range, 33) | Out-Null   # wdFieldPage

$doc.SaveAs([ref](Join-Path $outDir 'legacy.doc'), [ref]0)    # 0 = wdFormatDocument97
# 真值：Word 自己读到的全文
$text = $doc.Content.Text
$doc.Close($false)

# ───────────────────────── Excel：.xls（BIFF8）─────────────────────────
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
NoAlerts $xl
$wb = $xl.Workbooks.Add()
$s1 = $wb.Worksheets.Item(1)
$s1.Name = '预算'
$s1.Cells.Item(1, 1).Value2 = '项目'
$s1.Cells.Item(1, 2).Value2 = '金额'
$s1.Cells.Item(1, 3).Value2 = '日期'
$s1.Cells.Item(2, 1).Value2 = '服务器'
$s1.Cells.Item(2, 2).Value2 = 1234.5
$s1.Cells.Item(2, 3).Value2 = [datetime]'2026-11-01'
$s1.Cells.Item(3, 1).Value2 = '带宽'
$s1.Cells.Item(3, 2).Value2 = 0.25
$s1.Cells.Item(3, 3).Value2 = [datetime]'2026-12-01'
$s1.Range('B4').Formula = '=B2+B3'
$s1.Cells.Item(4, 1).Value2 = '合计'
$range = $s1.Range('A6:B6')
$range.Merge()
$s1.Cells.Item(6, 1).Value2 = '合并说明MX8'
$s1.Cells.Item(9, 3).Value2 = 42        # 稀疏行：第 9 行只有 C9
$marks['xlsText'] = '合并说明MX8'
$marks['xlsNum'] = '1234.5'
$wb.SaveAs([ref](Join-Path $outDir 'legacy.xls'), [ref]56)   # 56 = xlExcel8
$oracleXls = @()
foreach ($rowIdx in 1..9) {
  $line = @()
  for ($c = 1; $c -le 3; $c++) {
    $v = $s1.Cells.Item($rowIdx, $c).Text
    $line += ('{0}|{1}|{2}' -f $rowIdx, $c, $v)
  }
  $oracleXls += $line
}
$wb.Close($false)

# ───────────────────────── PowerPoint：.ppt（PowerPoint 97）─────────────────────────
$pp = New-Object -ComObject PowerPoint.Application
# PowerPoint 不接受 Visible=false（Office 的既有限制），用完立刻 Quit
NoAlerts $pp
$pres = $pp.Presentations.Add()
$slide1 = $pres.Slides.Add(1, 2)      # ppLayoutText
$slide1.Shapes.Item(1).TextFrame.TextRange.Text = '第一页标题PP5'
$slide1.Shapes.Item(2).TextFrame.TextRange.Text = "要点一`r要点二"
$slide2 = $pres.Slides.Add(2, 2)
$slide2.Shapes.Item(1).TextFrame.TextRange.Text = '第二页标题PP6'
$slide2.Shapes.Item(2).TextFrame.TextRange.Text = '跨网与延迟'
$marks['pptText'] = '第一页标题PP5'
$pres.SaveAs((Join-Path $outDir 'legacy.ppt'), 1)   # 1 = ppSaveAsPresentation
$oraclePpt = @()
foreach ($s in $pres.Slides) {
  foreach ($shp2 in $s.Shapes) {
    if ($shp2.HasTextFrame) { $oraclePpt += ('{0}|{1}' -f $s.SlideNumber, $shp2.TextFrame.TextRange.Text) }
  }
}
$pres.Close()

# ───────────────────────── 收尾：写 oracle.json ─────────────────────────
$wordVersion = $w.Version.ToString()
$w.Quit()
$xl.Quit()
$pp.Quit()

$obj = [pscustomobject]@{
  generatedBy   = 'scripts/legacy-oracle.ps1 (真 Microsoft Office COM)'
  wordVersion   = $wordVersion
  docText       = ($text -replace "`r", "`n")
  marks         = $marks
  xlsCells      = $oracleXls
  pptTexts      = $oraclePpt
}
$json = $obj | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText((Join-Path $outDir 'oracle.json'), $json, (New-Object System.Text.UTF8Encoding($false)))

Get-ChildItem $outDir | ForEach-Object { '{0}  {1} KB' -f $_.Name, [math]::Round($_.Length / 1KB) }
