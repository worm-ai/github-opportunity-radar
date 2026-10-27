"""Bounded local workflow experiment; synthetic PDFs, fixed unmodified upstream jars.

Never uploads documents, calls AI, overwrites inputs, or certifies accessibility.
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import csv
import json
import os
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / ".data/experiments/pdf-accessibility"
sys.path.insert(0, str(WORK / "python"))
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (ArrayObject, BooleanObject, DecodedStreamObject,
                          DictionaryObject, NameObject, NumberObject, TextStringObject)

JAVA = Path(os.environ.get("RADAR_EXPERIMENT_JAVA", r"D:\install\jetbreains\IntelliJ IDEA 2025.1\jbr\bin\java.exe"))
ODL = WORK / "python/opendataloader_pdf/jar/opendataloader-pdf-cli.jar"
VERIFIER = WORK / "verapdf-greenfield-apps-1.28.2.jar"


def name(value):
    return NameObject(value)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def alt_texts(node, seen=None):
    seen = set() if seen is None else seen
    if hasattr(node, "get_object"):
        node = node.get_object()
    if id(node) in seen:
        return []
    seen.add(id(node))
    if isinstance(node, dict):
        return ([str(node["/Alt"])] if "/Alt" in node else []) + sum((alt_texts(value, seen) for key, value in node.items() if str(key) not in ["/P", "/Pg", "/ParentTree"]), [])
    if isinstance(node, list):
        return sum((alt_texts(value, seen) for value in node), [])
    return []


def write_pdf(relative, title, body, tagged=False, image_only=False):
    path = WORK / "input" / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    font = writer._add_object(DictionaryObject({name("/Type"): name("/Font"), name("/Subtype"): name("/Type1"), name("/BaseFont"): name("/Helvetica")}))
    resources = DictionaryObject({name("/Font"): DictionaryObject({name("/F1"): font})})
    stream = DecodedStreamObject()
    text = "" if image_only else f"BT /F1 20 Tf 60 720 Td ({title}) Tj /F1 12 Tf 0 -40 Td ({body}) Tj ET\n"
    if tagged or image_only:
        image = DecodedStreamObject()
        image.set_data(bytes([30, 100, 160, 250, 210, 20, 30, 100, 160, 250, 210, 20]))
        image.update({name("/Type"): name("/XObject"), name("/Subtype"): name("/Image"), name("/Width"): NumberObject(2), name("/Height"): NumberObject(2), name("/ColorSpace"): name("/DeviceRGB"), name("/BitsPerComponent"): NumberObject(8)})
        image_ref = writer._add_object(image)
        resources[name("/XObject")] = DictionaryObject({name("/Im0"): image_ref})
        paint = "q 180 0 0 100 60 500 cm /Im0 Do Q\n"
        if tagged:
            paint = "/Figure <</MCID 0>> BDC\n" + paint + "EMC\n"
            tree = DictionaryObject({name("/Type"): name("/StructTreeRoot")})
            tree_ref = writer._add_object(tree)
            figure = writer._add_object(DictionaryObject({name("/Type"): name("/StructElem"), name("/S"): name("/Figure"), name("/P"): tree_ref, name("/Pg"): page.indirect_reference, name("/K"): NumberObject(0), name("/Alt"): TextStringObject("HUMAN_CURATED_ALT_SENTINEL: a two-colour synthetic diagram.")}))
            tree[name("/K")] = ArrayObject([figure])
            tree[name("/ParentTree")] = writer._add_object(DictionaryObject({name("/Nums"): ArrayObject([NumberObject(0), ArrayObject([figure])])}))
            page[name("/StructParents")] = NumberObject(0)
            writer._root_object[name("/StructTreeRoot")] = tree_ref
            writer._root_object[name("/MarkInfo")] = DictionaryObject({name("/Marked"): BooleanObject(True)})
        text += paint
    stream.set_data(text.encode("ascii"))
    page[name("/Contents")] = writer._add_object(stream)
    page[name("/Resources")] = resources
    writer.add_metadata({"/Title": title, "/Producer": "Opportunity Radar synthetic workflow experiment"})
    with path.open("wb") as output:
        writer.write(output)
    return path


def execute(label, jar, arguments):
    started = time.perf_counter()
    entry = ["-cp", str(jar), "org.verapdf.apps.GreenfieldCliWrapper"] if jar == VERIFIER else ["-jar", str(jar)]
    result = subprocess.run([str(JAVA), "-Djava.awt.headless=true", "-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8", "-Duser.language=en", "-Duser.country=US", *entry, *map(str, arguments)], capture_output=True, timeout=60)
    record = {"label": label, "arguments": list(map(str, arguments)), "exitCode": result.returncode, "seconds": round(time.perf_counter()-started, 3), "stdout": result.stdout.decode("utf8", "replace"), "stderr": result.stderr.decode("utf8", "replace")}
    (WORK / "logs" / f"{label}.json").write_text(json.dumps(record, indent=2), encoding="utf8")
    return record


def main():
    assert JAVA.is_file() and ODL.is_file() and VERIFIER.is_file(), "Prepare pinned dependencies first"
    assert digest(ODL) == "48ed84b5bf28e6ba82b8f37771fa5604b1f864bf529543910c8825a68965210c"
    assert digest(VERIFIER) == "687d4d8bcfec48c9f7e931cf78ed061f1eeccfba55d4cdc000ba9b4d8aa46ce6"
    executed_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    (WORK / "logs").mkdir(parents=True, exist_ok=True)
    source = [
        write_pdf("department-a/handout.pdf", "Department A", "COURSE_A_SENTINEL: enrolment opens on Monday."),
        write_pdf("department-b/handout.pdf", "Department B", "COURSE_B_SENTINEL: enrolment opens on Friday."),
        write_pdf("review/curated.pdf", "Existing human work", "This fixture has partial tags, not full PDF/UA conformance.", tagged=True),
        write_pdf("review/image-only.pdf", "Synthetic image-only input", "", image_only=True),
    ]
    baseline = execute("upstream-folder-baseline", ODL, ["--format", "json,tagged-pdf", "--output-dir", WORK / "baseline", WORK / "input"])
    rows = []
    for path in source:
        relative = path.relative_to(WORK / "input")
        reader = PdfReader(path)
        tagged = bool(reader.trailer["/Root"].get("/StructTreeRoot"))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        row = {"input": relative.as_posix(), "inputSha256": digest(path), "hasStructureTree": tagged, "textCharacters": len(text)}
        output = WORK / "routed" / relative.parent
        output.mkdir(parents=True, exist_ok=True)
        if tagged:
            target = output / path.name
            shutil.copyfile(path, target)
            row.update({"route": "preserve-existing-tags-for-human-review", "output": str(target.relative_to(WORK)), "outputSha256": digest(target), "bytesPreserved": digest(target) == digest(path)})
        elif not text.strip():
            row.update({"route": "needs-ocr-and-human-review", "reason": "No extracted text; this is an image-only diagnostic, not an OCR quality test."})
        else:
            conversion = execute(f"convert-{relative.parent.name}", ODL, ["--format", "json,tagged-pdf", "--output-dir", output, path])
            pdfs = list(output.glob("*.pdf"))
            row.update({"route": "tag-and-validate-before-human-review", "conversionExitCode": conversion["exitCode"], "generatedPdfs": [str(pdf.relative_to(WORK)) for pdf in pdfs]})
            if len(pdfs) == 1:
                generated = PdfReader(pdfs[0])
                row["outputSha256"] = digest(pdfs[0])
                row["outputHasStructureTree"] = bool(generated.trailer["/Root"].get("/StructTreeRoot"))
                row["outputText"] = "\n".join(page.extract_text() or "" for page in generated.pages)
                validation = execute(f"validate-{relative.parent.name}", VERIFIER, ["--flavour", "ua1", "--format", "json", pdfs[0]])
                row["validationExitCode"] = validation["exitCode"]
                try:
                    row["validationReport"] = json.loads(validation["stdout"])
                    report = row["validationReport"]["report"]["jobs"][0]["validationResult"][0]
                    row["validationSummary"] = {"profile": report["profileName"], "completed": report["jobEndStatus"] == "normal", "compliant": report["compliant"], "failedRules": report["details"]["failedRules"], "failedChecks": report["details"]["failedChecks"]}
                except json.JSONDecodeError:
                    row["validationReportError"] = validation["stderr"] or validation["stdout"]
        rows.append(row)
    baseline_text = PdfReader(WORK / "baseline/handout_tagged.pdf").pages[0].extract_text()
    original_alt = alt_texts(PdfReader(source[2]).trailer["/Root"]["/StructTreeRoot"])
    retagged_alt = alt_texts(PdfReader(WORK / "baseline/curated_tagged.pdf").trailer["/Root"]["/StructTreeRoot"])
    assert baseline["exitCode"] == 0
    assert "COURSE_B_SENTINEL" in baseline_text and "COURSE_A_SENTINEL" not in baseline_text
    for row, own, other in [(rows[0], "COURSE_A_SENTINEL", "COURSE_B_SENTINEL"), (rows[1], "COURSE_B_SENTINEL", "COURSE_A_SENTINEL")]:
        assert row["conversionExitCode"] == 0 and row["outputHasStructureTree"]
        assert own in row["outputText"] and other not in row["outputText"]
        assert row["validationSummary"]["completed"] and not row["validationSummary"]["compliant"]
    assert rows[2]["bytesPreserved"] and rows[3]["route"] == "needs-ocr-and-human-review"
    assert original_alt != retagged_alt
    assert all(digest(path) == row["inputSha256"] for path, row in zip(source, rows))
    result = {"syntheticOnly": True, "paidApiCalls": 0, "jarSha256": {"opendataloader2.5.13": digest(ODL), "verapdf1.28.2": digest(VERIFIER)}, "baselineExitCode": baseline["exitCode"], "baselineFiles": [str(path.relative_to(WORK)) for path in (WORK / "baseline").rglob("*") if path.is_file()], "baselineCollision": {"overwrittenSentinel": "COURSE_A_SENTINEL", "survivingSentinel": "COURSE_B_SENTINEL"}, "altTextComparison": {"original": original_alt, "retagged": retagged_alt, "routedInputBytesPreserved": rows[2]["bytesPreserved"]}, "rows": rows, "limits": ["Four synthetic single-page PDFs; not a real institutional corpus or a user trial.", "Helvetica is not embedded; fixture validation failures cannot establish the upstream tool's general compliance quality.", "The existing-tag fixture is deliberately incomplete; preserving bytes does not establish accessibility.", "No OCR, AI, AWS, Adobe, enterprise export or assistive-technology testing was executed.", "A mechanical validator result cannot establish correct reading order or meaningful alt text."]}
    result["executedAt"] = executed_at
    (WORK / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf8")
    with (WORK / "review-queue.csv").open("w", encoding="utf8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=["input", "route", "automaticCheck", "failedRules", "humanReview"])
        writer.writeheader()
        for row in rows:
            summary = row.get("validationSummary", {})
            writer.writerow({"input": row["input"], "route": row["route"], "automaticCheck": "not-compliant" if summary.get("completed") and not summary.get("compliant") else "not-run", "failedRules": summary.get("failedRules", ""), "humanReview": "required"})
    print(json.dumps({"baselineExitCode": result["baselineExitCode"], "rows": [{key: row[key] for key in ["input", "route", "outputHasStructureTree", "bytesPreserved", "validationExitCode"] if key in row} for row in rows]}), flush=True)


if __name__ == "__main__":
    main()
