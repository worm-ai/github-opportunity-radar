"""Local public-document experiment; never uploads files or certifies accessibility."""
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import csv
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
DEPENDENCIES = ROOT / ".data/experiments/pdf-accessibility"
CORPUS = ROOT / ".data/experiments/pdf-real-corpus"
sys.path.insert(0, str(DEPENDENCIES / "python"))
from pypdf import PdfReader

JAVA = Path(os.environ.get("RADAR_EXPERIMENT_JAVA", r"D:\install\jetbreains\IntelliJ IDEA 2025.1\jbr\bin\java.exe"))
ODL = DEPENDENCIES / "python/opendataloader_pdf/jar/opendataloader-pdf-cli.jar"
VERIFIER = DEPENDENCIES / "verapdf-greenfield-apps-1.28.2.jar"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inspect(path):
    reader = PdfReader(path)
    if len(reader.pages) > 100:
        raise ValueError("Document exceeds 100-page experiment bound")
    texts = [page.extract_text() or "" for page in reader.pages]
    root = reader.trailer["/Root"]
    info = {"pages": len(texts), "encrypted": reader.is_encrypted,
            "hasStructureTree": "/StructTreeRoot" in root,
            "formFields": len(reader.get_fields() or {}),
            "charactersByPage": [len(text) for text in texts],
            "noExtractedTextPages": [i + 1 for i, text in enumerate(texts) if not text.strip()],
            "title": str((reader.metadata or {}).get("/Title", ""))}
    return info, texts


def execute(work, label, jar, arguments, timeout=180):
    print(json.dumps({"stage": label, "state": "started"}), flush=True)
    entry = ["-cp", str(jar), "org.verapdf.apps.GreenfieldCliWrapper"] if jar == VERIFIER else ["-jar", str(jar)]
    command = [str(JAVA), "-Djava.awt.headless=true", "-Dfile.encoding=UTF-8",
               "-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8", "-Duser.language=en",
               "-Duser.country=US", *entry, *map(str, arguments)]
    started = time.perf_counter()
    try:
        result = subprocess.run(command, capture_output=True, timeout=timeout)
        record = {"exitCode": result.returncode, "timedOut": False,
                  "stdout": result.stdout.decode("utf8", "replace"),
                  "stderr": result.stderr.decode("utf8", "replace")}
    except subprocess.TimeoutExpired as error:
        record = {"exitCode": None, "timedOut": True,
                  "stdout": (error.stdout or b"").decode("utf8", "replace"),
                  "stderr": (error.stderr or b"").decode("utf8", "replace")}
    record.update({"label": label, "arguments": list(map(str, arguments)),
                   "seconds": round(time.perf_counter() - started, 3)})
    (work / "logs" / f"{label}.json").write_text(json.dumps(record, indent=2), encoding="utf8")
    print(json.dumps({key: record[key] for key in ["label", "exitCode", "timedOut", "seconds"]}), flush=True)
    return record


def validate(work, label, path):
    execution = execute(work, label, VERIFIER, ["--flavour", "ua1", "--format", "json", path])
    summary = {"completed": False, "seconds": execution["seconds"],
               "log": f"logs/{label}.json", "exitCode": execution["exitCode"]}
    try:
        report = json.loads(execution["stdout"])["report"]["jobs"][0]["validationResult"][0]
        summary.update({"completed": report["jobEndStatus"] == "normal",
                        "profile": report["profileName"], "compliant": report["compliant"],
                        "failedRules": report["details"]["failedRules"],
                        "failedChecks": report["details"]["failedChecks"]})
    except (ValueError, KeyError, IndexError, TypeError) as error:
        summary["reportError"] = str(error)
    return summary


def compare(before, after):
    # Per-page character multisets ignore extraction order. Equal counts are
    # only a content diagnostic, not proof of visual or semantic preservation.
    pages = []
    for i, original in enumerate(before):
        generated = after[i] if i < len(after) else ""
        left = Counter(c for c in original if not c.isspace())
        right = Counter(c for c in generated if not c.isspace())
        pages.append({"page": i + 1, "sameNonWhitespaceCharacters": left == right,
                      "sameExtractedText": original == generated,
                      "missingCharacters": sum((left - right).values()),
                      "addedCharacters": sum((right - left).values())})
    return {"samePageCount": len(before) == len(after),
            "allPageCharacterMultisetsEqual": len(before) == len(after) and all(row["sameNonWhitespaceCharacters"] for row in pages),
            "allExtractedTextEqual": before == after, "pages": pages,
            "visualRenderingTested": False, "readingOrderTested": False,
            "altSemanticsTested": False}


def main():
    assert JAVA.is_file() and ODL.is_file() and VERIFIER.is_file(), "Prepare fixed dependencies first"
    assert digest(ODL) == "48ed84b5bf28e6ba82b8f37771fa5604b1f864bf529543910c8825a68965210c"
    assert digest(VERIFIER) == "687d4d8bcfec48c9f7e931cf78ed061f1eeccfba55d4cdc000ba9b4d8aa46ce6"
    manifest = json.loads((CORPUS / "sources.json").read_text(encoding="utf8"))
    available = [source for source in manifest["sources"] if source["status"] == "available"]
    assert 0 < len(available) <= 12, "No acquired sources, or corpus exceeds 12-file bound"
    executed_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    work = CORPUS / "runs" / "".join(c for c in executed_at if c.isdigit())
    (work / "logs").mkdir(parents=True, exist_ok=False)
    shutil.copyfile(CORPUS / "sources.json", work / "sources.json")
    rows = []
    for i, source in enumerate(available):
        path = (CORPUS / "input" / source["path"]).resolve()
        assert path.is_relative_to((CORPUS / "input").resolve()), "Input outside corpus"
        assert path.stat().st_size <= 25 * 1024 * 1024 and digest(path) == source["sha256"]
        row = {"input": source["path"], "source": source, "inputSha256": digest(path)}
        rows.append(row)
        try:
            info, original_text = inspect(path)
            row["inputInfo"] = info
            row["beforeValidation"] = validate(work, f"{i:02d}-before", path)
            output = work / "output" / Path(source["path"]).parent
            output.mkdir(parents=True, exist_ok=True)
            if info["hasStructureTree"] or info["formFields"]:
                target = output / path.name
                shutil.copyfile(path, target)
                row.update({"route": "preserve-existing-structure-or-form-for-human-review",
                            "output": target.relative_to(work).as_posix(),
                            "outputSha256": digest(target), "bytesPreserved": digest(target) == digest(path)})
            elif not any(text.strip() for text in original_text):
                row.update({"route": "no-text-layer-needs-human-triage",
                            "reason": "No extracted text is a diagnostic, not proof that OCR is appropriate. OCR was not run."})
            else:
                execution = execute(work, f"{i:02d}-tag", ODL, ["--format", "json,tagged-pdf", "--output-dir", output, path])
                row.update({"route": "tag-text-and-validate-with-human-review",
                            "conversion": {key: execution[key] for key in ["exitCode", "timedOut", "seconds"]}})
                generated = list(output.glob("*.pdf"))
                row["generatedPdfs"] = [pdf.relative_to(work).as_posix() for pdf in generated]
                if execution["exitCode"] == 0 and len(generated) == 1:
                    output_info, output_text = inspect(generated[0])
                    row.update({"output": generated[0].relative_to(work).as_posix(),
                                "outputSha256": digest(generated[0]), "outputInfo": output_info,
                                "contentComparison": compare(original_text, output_text),
                                "afterValidation": validate(work, f"{i:02d}-after", generated[0])})
                else:
                    row["error"] = "Conversion did not produce exactly one PDF with a successful exit"
            row["humanReview"] = ["Verify visual content, reading order, table structure and meaningful alternative text.",
                                  "Mechanical PDF/UA checks alone do not establish accessibility."]
            if info["noExtractedTextPages"]:
                row["humanReview"].append(f"Inspect pages with no extracted text: {info['noExtractedTextPages']}; distinguish blank/artwork from scans.")
        except Exception as error:
            row["error"] = f"{type(error).__name__}: {error}"
            row["route"] = "processing-error-human-triage"
        row["inputUnchanged"] = digest(path) == row["inputSha256"]
        assert row["inputUnchanged"], "Experiment altered an input"
        print(json.dumps({"input": row["input"], "route": row["route"], "error": row.get("error")}), flush=True)
    result = {"executedAt": executed_at, "publicCorpus": True, "syntheticOnly": False,
              "userTrial": False, "paidApiCalls": 0, "plannedSources": len(manifest["sources"]),
              "acquiredSources": len(available), "rows": rows,
              "jarSha256": {"opendataloader2.5.13": digest(ODL), "verapdf1.28.2": digest(VERIFIER)},
              "limitations": [*manifest["limitations"],
                              "Machine durations are not human time saved or evidence of demand.",
                              "Character equality does not verify rendering, reading order, table meaning or image descriptions.",
                              "No OCR, AI, Adobe, enterprise export, assistive technology or expert review was run."]}
    (work / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf8")
    with (work / "review-queue.csv").open("w", encoding="utf8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=["input", "pages", "route", "automaticCheck", "failedRules", "textlessPages", "humanReview"])
        writer.writeheader()
        for row in rows:
            validation = row.get("afterValidation", row.get("beforeValidation", {}))
            writer.writerow({"input": row["input"], "pages": row.get("inputInfo", {}).get("pages", ""),
                             "route": row["route"], "automaticCheck": ("compliant" if validation.get("compliant") else "not-compliant") if validation.get("completed") else "incomplete",
                             "failedRules": validation.get("failedRules", ""),
                             "textlessPages": json.dumps(row.get("inputInfo", {}).get("noExtractedTextPages", [])),
                             "humanReview": "Required; see result.json for tasks and limits"})
    (CORPUS / "latest-run.json").write_text(json.dumps({"directory": str(work), "executedAt": executed_at}), encoding="utf8")
    print(json.dumps({"directory": str(work), "acquiredSources": len(available),
                      "pages": sum(row.get("inputInfo", {}).get("pages", 0) for row in rows),
                      "processingErrors": sum(bool(row.get("error")) for row in rows)}), flush=True)


if __name__ == "__main__":
    main()
