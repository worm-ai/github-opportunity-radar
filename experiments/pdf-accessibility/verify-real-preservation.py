"""Additional local rendering/link checks; no original artwork is distributed."""
from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "experiments/pdf-accessibility"))
# Hyphenated runner is a standalone file; use its fixed dependency directory.
sys.path.insert(0, str(ROOT / ".data/experiments/pdf-accessibility/python"))
from pypdf import PdfReader


def annotation_snapshot(path):
    reader = PdfReader(path)
    links, annotation_pages = [], []
    for index, page in enumerate(reader.pages):
        annotations = page.get("/Annots", [])
        if annotations:
            annotation_pages.append({"page": index + 1, "annotations": len(annotations)})
        for ref in annotations:
            annotation = ref.get_object()
            if annotation.get("/Subtype") != "/Link":
                continue
            action = annotation.get("/A", {})
            action = action.get_object() if hasattr(action, "get_object") else action
            destination = annotation.get("/Dest", action.get("/D"))
            if hasattr(destination, "get_object"):
                destination = destination.get_object()
            target = None
            if isinstance(destination, list) and destination:
                for p, candidate in enumerate(reader.pages):
                    if candidate.indirect_reference == destination[0]:
                        target = p + 1
                        break
                suffix = [str(value) for value in destination[1:]]
            else:
                suffix = str(destination) if destination is not None else None
            links.append({"page": index + 1, "rectangle": [str(n) for n in annotation.get("/Rect", [])],
                          "action": str(action.get("/S", "")), "uri": str(action.get("/URI", "")),
                          "destinationPage": target, "destinationParameters": suffix})
    return {"annotationPages": annotation_pages, "links": links}


def main():
    corpus = ROOT / ".data/experiments/pdf-real-corpus"
    work = Path(json.loads((corpus / "latest-run.json").read_text())["directory"])
    result = json.loads((work / "result.json").read_text())
    rows = []
    for index, row in enumerate(result["rows"]):
        if "outputInfo" not in row:
            continue
        source, target = corpus / "input" / row["input"], work / row["output"]
        before, after = annotation_snapshot(source), annotation_snapshot(target)
        serialize = lambda item: json.dumps(item, sort_keys=True)
        link_comparison = {"beforeLinks": len(before["links"]), "afterLinks": len(after["links"]),
                           "sameAnnotationPagesAndCounts": before["annotationPages"] == after["annotationPages"],
                           "sameLinkTargetsAndRectangles": Counter(map(serialize, before["links"])) == Counter(map(serialize, after["links"])),
                           "annotationPages": after["annotationPages"],
                           "unresolvedDestinationLinks": sum(link["destinationPage"] is None and not link["uri"] for link in before["links"])}
        print(json.dumps({"stage": "render-and-compare", "input": row["input"]}), flush=True)
        java = ROOT / "experiments/pdf-accessibility/ComparePdfRendering.java"
        jar = ROOT / ".data/experiments/pdf-accessibility/python/opendataloader_pdf/jar/opendataloader-pdf-cli.jar"
        executable = os.environ.get("RADAR_EXPERIMENT_JAVA", r"D:\install\jetbreains\IntelliJ IDEA 2025.1\jbr\bin\java.exe")
        command = [executable, "-Xmx768m", "-Djava.awt.headless=true", "-Dfile.encoding=UTF-8", "--class-path", str(jar), str(java), str(source), str(target)]
        started = time.perf_counter()
        try:
            executed = subprocess.run(command, capture_output=True, timeout=180)
            log = {"exitCode": executed.returncode, "stdout": executed.stdout.decode("utf8", "replace"),
                   "stderr": executed.stderr.decode("utf8", "replace"), "seconds": round(time.perf_counter() - started, 3)}
            try:
                rendering = json.loads(log["stdout"]) if executed.returncode == 0 else {"completed": False}
                rendering["completed"] = executed.returncode == 0
            except ValueError:
                rendering = {"completed": False, "reason": "Renderer did not produce a complete JSON report"}
        except subprocess.TimeoutExpired as error:
            log = {"exitCode": None, "stdout": (error.stdout or b"").decode("utf8", "replace"),
                   "stderr": (error.stderr or b"").decode("utf8", "replace"), "timedOut": True}
            rendering = {"completed": False, "reason": "Renderer timed out"}
        (work / "logs" / f"{index:02d}-preservation-render.json").write_text(json.dumps(log, indent=2), encoding="utf8")
        rows.append({"input": row["input"], "links": link_comparison, "rendering": rendering})
        print(json.dumps({"links": link_comparison, "rendering": {key: value for key, value in rendering.items() if key != "pages"}}), flush=True)
    report = {"executedAt": datetime.now(timezone.utc).isoformat(), "rows": rows,
              "limits": ["Pixel equality is specific to the bundled PDFBox renderer at 72 DPI; no cross-renderer or human visual assessment.",
                         "Link destination equality does not establish useful navigation or accessible link descriptions.",
                         "No page images, original/converted PDFs or artwork were exported to product artifacts.",
                         "Semantic reading order, table meaning, image descriptions and assistive technology remain untested."]}
    (work / "preservation.json").write_text(json.dumps(report, indent=2), encoding="utf8")


if __name__ == "__main__":
    main()
