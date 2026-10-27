"""Build a review packet from executed evidence, without distributing PDFs/artwork."""
from collections import Counter
from datetime import datetime, timezone
import csv
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".data/experiments/pdf-accessibility/python"))
from pypdf import PdfReader


def structure_diagnostic(path):
    reader = PdfReader(path)
    pages = {(p.indirect_reference.idnum, p.indirect_reference.generation): i + 1 for i, p in enumerate(reader.pages)}
    elements, seen = [], set()

    def visit(node, page=None):
        if hasattr(node, "get_object"):
            node = node.get_object()
        if isinstance(node, dict):
            if id(node) in seen:
                return
            seen.add(id(node))
            ref = node.get("/Pg")
            if hasattr(ref, "idnum"):
                page = pages.get((ref.idnum, ref.generation), page)
            if "/S" in node:
                elements.append({"tag": str(node["/S"]), "page": page, "alt": str(node.get("/Alt", ""))})
            if "/K" in node:
                visit(node["/K"], page)
        elif isinstance(node, list):
            for child in node:
                visit(child, page)

    visit(reader.trailer["/Root"]["/StructTreeRoot"])
    figures = [element for element in elements if element["tag"] == "/Figure"]
    return {"tagCounts": dict(Counter(e["tag"] for e in elements)),
            "page13TagCounts": dict(Counter(e["tag"] for e in elements if e["page"] == 13)),
            "tables": [e for e in elements if e["tag"] == "/Table"],
            "figures": len(figures),
            "genericImageAlt": sum(bool(re.fullmatch(r"image\s*\d+", e["alt"], re.I)) for e in figures),
            "figureAltSample": figures[:3]}


def main():
    corpus = ROOT / ".data/experiments/pdf-real-corpus"
    work = Path(json.loads((corpus / "latest-run.json").read_text())["directory"])
    result = json.loads((work / "result.json").read_text())
    assert len(result["rows"]) == 1, "This packet describes the one executed handbook, not the unacquired corpus"
    row = result["rows"][0]
    assert row["inputSha256"] == "a76a4289e3fed87ec3bb7a3ea82f5de46d7417e1bbdea8ce7691a620e21c7ff9"
    preserve = json.loads((work / "preservation.json").read_text())["rows"][0]
    diagnostic = structure_diagnostic(work / row["output"])
    (work / "structure-diagnostic.json").write_text(json.dumps(diagnostic, indent=2), encoding="utf8")
    assert diagnostic["page13TagCounts"].get("/Table", 0) == 0
    assert diagnostic["page13TagCounts"].get("/LI") == 20
    assert diagnostic["figures"] == diagnostic["genericImageAlt"] == 41
    converted = json.loads(next((work / "output").rglob("handbook.json")).read_text())
    elements = []

    def visit(value):
        if isinstance(value, dict):
            if value.get("type") in ["image", "table"]:
                elements.append(value)
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(converted)
    tasks = []

    def add(kind, page, target, reason):
        tasks.append({"id": f"review-{len(tasks)+1:03d}", "kind": kind, "pdfPage": page,
                      "target": target, "reason": reason, "status": "NOT REVIEWED",
                      "reviewer": "", "minutes": "", "outcome": ""})

    add("known-semantic-gap", 13, "Thief Abilities table", "Agent inspected local page rendering: eight columns and twenty data rows; generated PDF tags are P + L/LI, not Table/TR/TH/TD. PDF page 13 is printed page 9.")
    add("document-rule", "all", "PDF/UA-1 6.2 test1", "MarkInfo/Marked rule fails; expert must assess the full document before declaring conformance.")
    add("document-rule", "all", "PDF/UA-1 7.1 test8", "Required metadata-stream rule fails; metadata repair alone does not resolve semantic gaps.")
    for page in preserve["links"]["annotationPages"]:
        add("annotation-page", page["page"], "PDF/UA-1 7.18.3 test1", "Page Tabs=S rule fails; also inspect navigation and link descriptions.")
    for element in elements:
        page, identifier = element.get("page number", "unknown"), element.get("id", "unknown")
        reason = "Classify decorative vs meaningful content; all 41 PDF Figure tags have generic image N alternatives. Write/verify meaningful alternatives where required." if element["type"] == "image" else "Verify table detection, headers, cell associations and reading order. Detection is not correctness."
        add(element["type"], page, f"upstream element {identifier}; bbox={element.get('bounding box')}", reason)
    for page in range(1, row["inputInfo"]["pages"] + 1):
        add("reading-order", page, "page structure and assistive technology", "Check logical reading order, headings and meaningful content; page 4 has no extracted text and must be classified as artwork/blank/scan by a reviewer.")
    with (work / "review-tasks.csv").open("w", encoding="utf8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=list(tasks[0]))
        writer.writeheader()
        writer.writerows(tasks)
    review = {"preparedAt": datetime.now(timezone.utc).isoformat(), "tasks": len(tasks),
              "reviewedByExpert": 0, "userTrials": 0, "marketValidation": 0,
              "agentVisualInspection": {"pdfPage": 13, "printedPage": 9,
                                        "observedTableColumns": 8, "observedDataRows": 20,
                                        "generatedRoles": ["/P", "/L", "/LI"]},
              "limits": ["Queue items overlap and are not a count of unique defects or measured human workload.",
                         "Only page 13 received a targeted agent visual/structure comparison; this is not expert or assistive-technology testing."]}
    (work / "review-packet.json").write_text(json.dumps(review, indent=2), encoding="utf8")
    logs = {path.stem: json.loads(path.read_text()) for path in sorted((work / "logs").glob("*.json"))}
    (work / "execution-logs.json").write_text(json.dumps(logs, indent=2), encoding="utf8")
    runtime = json.loads((ROOT / ".data/experiments/pdf-accessibility/runtime.json").read_text(encoding="utf-8-sig"))
    (work / "runtime.json").write_text(json.dumps(runtime, ensure_ascii=False, indent=2), encoding="utf8")
    handoff = f"""# 真实公开手册：人工复核任务包

对象是 Chris Gonnerman 的《Basic Fantasy Role-Playing Game 4th Edition》，66页。原件已随 iii 仓库下载，Git blob 4bf6e9edc87b21886d97684e2c942e162e409e7b；SHA-256 {row['inputSha256']}。它不是高校客户材料。正文/地图为 CC BY-SA 4.0，插图另有权限限制；本地评估用，产品归档不提供原PDF、转换PDF或页面图片。

## 已执行结果

- 原件和打标件均由 veraPDF 正常完成 PDF/UA-1 机械检查：失败规则8→3，失败检查10647→20。检查数量不是质量百分比。
- 打标耗时9.815秒，前/后检查3.092/4.881秒；这是本机单次机器用时，未测人工节省。
- 66页逐页提取文本完全一致；同一PDFBox渲染器72DPI逐像素比较均相同。122个链接的目标/坐标、18个页面的注释数量一致；原件哈希未改变。
- 第13个PDF页面（印刷页9）的8列表格实际被标成段落和20个列表项。41个Figure的Alt全部是image N。这些语义问题不能靠补三个机械字段解决。
- 其余11份计划材料未下载，本次manifest是离线模式；不能算作失败文档或机构代表性样本。HTTPS证书问题另行记录。

## 如何接手

1. 在本机对照 `input/{row['input']}` 和该次运行的 `{row['output']}`；目录根为 `.data/experiments/pdf-real-corpus`，结果位于 `runs/{work.name}`。不要直接把打标件对外交付为合规文件。
2. 先检查PDF页13表格、页4全图内容、页3目录跳转，再抽查页8与页58表格、双栏阅读顺序、标题层级和图片用途。页58是自动识别到的表格，不能据此认为其他页面没有表格。
3. `review-tasks.csv` 提供逐页/元素定位，`status/reviewer/minutes/outcome` 留空待填；所有{len(tasks)}项都是待复核任务，存在重叠，不是{len(tasks)}个已确认缺陷，也不是人工工时。
4. 由有经验的无障碍人员使用其惯用修复器与辅助技术评估。记录哪些任务可批量处理、哪些必须逐份修复，以及是否比其现有完整方案更省事。本次未运行Adobe、ASU/AWS、OCR、企业版或屏幕阅读器。
5. 决定是否继续：只有出现真实工作量收益和负责文档团队的采用意愿，才继续服务产品化。若现有工具/上游改动足够，采用或停止独立平台。未获得授权，不联系GitHub讨论作者。

机器检查报告、逐页像素/文本诊断和原始命令在其他JSON中。目录任务包让下一位评估者知道从何开始，但尚未发生专家评估、真实用户试用或市场验证。
"""
    (work / "review-handoff.md").write_text(handoff, encoding="utf8")
    print(json.dumps({"directory": str(work), "tasks": len(tasks), "expertReviewed": 0,
                      "allPagePixelsEqual": preserve["rendering"]["totalDifferentPixels"] == 0,
                      "page13TableMissing": True, "genericFigureAlt": diagnostic["genericImageAlt"]}))


if __name__ == "__main__":
    main()
