"""Check printed PDFs against actual HTML text; uses the existing local pypdf runtime."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".data/experiments/pdf-accessibility/python"))
from pypdf import PdfReader

directory = ROOT / ".data/browser/demand-handoff"
results = []
for name in ["social-original", "social-source", "self-use", "adversarial"]:
    reader = PdfReader(directory / f"{name}.pdf")
    normalized = lambda value: re.sub(r"\s+", "", value)
    text = normalized("\n".join(page.extract_text() for page in reader.pages))
    expected = json.loads((directory / f"{name}-expected.json").read_text(encoding="utf-8"))
    missing = [value for value in expected if normalized(value) not in text]
    assert not missing, (name, len(missing), missing[:3])
    links = []
    for page in reader.pages:
        for ref in page.get("/Annots", []):
            action = ref.get_object().get("/A")
            if action and action.get("/URI"):
                links.append(str(action["/URI"]))
    assert links, (name, "PDF has no source hyperlinks")
    assert all(value.startswith(("http://", "https://")) for value in links)
    results.append({"name": name, "pages": len(reader.pages), "expectedTextSegments": len(expected), "missingTextSegments": 0, "sourceLinks": len(links)})
(directory / "pdf-verification.json").write_text(json.dumps({"results": results, "limitation": "Text and hyperlink preservation in Edge A4 output; not a cross-browser typography or accessibility certification."}, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(results, ensure_ascii=False))
