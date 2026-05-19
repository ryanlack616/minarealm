from __future__ import annotations

import math
import re
import textwrap
import unicodedata
from pathlib import Path


PAGE_WIDTH = 612
PAGE_HEIGHT = 792
LEFT_MARGIN = 54
TOP_MARGIN = 54
BOTTOM_MARGIN = 54
CONTENT_WIDTH = PAGE_WIDTH - (LEFT_MARGIN * 2)
MAX_CHARS = 88


def normalize_text(value: str) -> str:
	replacements = {
		"\u2019": "'",
		"\u2018": "'",
		"\u201c": '"',
		"\u201d": '"',
		"\u2013": "-",
		"\u2014": "-",
		"\u2022": "-",
		"\u00a0": " ",
		"\u2192": "->",
		"\u00a9": "(c)",
	}
	for old, new in replacements.items():
		value = value.replace(old, new)
	value = unicodedata.normalize("NFKD", value).encode("latin-1", "ignore").decode("latin-1")
	return value


def parse_markdown(markdown_text: str) -> list[dict[str, object]]:
	blocks: list[dict[str, object]] = []
	in_table = False

	for raw_line in markdown_text.splitlines():
		line = normalize_text(raw_line.rstrip())
		stripped = line.strip()

		if not stripped:
			blocks.append({"type": "blank"})
			in_table = False
			continue

		if stripped.startswith("|") and stripped.endswith("|"):
			if re.fullmatch(r"\|(?:\s*:?-{3,}:?\s*\|)+", stripped):
				continue
			row = [cell.strip() for cell in stripped.strip("|").split("|")]
			text = " | ".join(row)
			blocks.append({"type": "table", "text": text})
			in_table = True
			continue

		if stripped.startswith("#"):
			level = len(stripped) - len(stripped.lstrip("#"))
			text = stripped[level:].strip()
			blocks.append({"type": "heading", "level": level, "text": text})
			in_table = False
			continue

		if stripped.startswith("- "):
			blocks.append({"type": "bullet", "text": stripped[2:].strip()})
			in_table = False
			continue

		if re.match(r"^\d+\.\s", stripped):
			blocks.append({"type": "number", "text": stripped})
			in_table = False
			continue

		if stripped.endswith(":") and not in_table:
			blocks.append({"type": "label", "text": stripped})
			continue

		blocks.append({"type": "paragraph", "text": stripped})
		in_table = False

	return blocks


def wrap_block(block: dict[str, object]) -> list[tuple[str, int, int]]:
	kind = block["type"]
	if kind == "blank":
		return [("", 12, 0)]

	if kind == "heading":
		level = int(block["level"])
		size = {1: 18, 2: 14, 3: 12}.get(level, 11)
		text = str(block["text"])
		return [(text, size, 0), ("", 8, 0)]

	if kind == "label":
		return [(str(block["text"]), 11, 0)]

	if kind == "table":
		wrapped = textwrap.wrap(str(block["text"]), width=MAX_CHARS, subsequent_indent="  ")
		return [(line, 9, 0) for line in wrapped]

	if kind == "bullet":
		wrapped = textwrap.wrap(str(block["text"]), width=MAX_CHARS - 2, subsequent_indent="  ") or [""]
		lines = []
		for index, line in enumerate(wrapped):
			prefix = "- " if index == 0 else "  "
			lines.append((prefix + line, 11, 0))
		return lines

	text = str(block["text"])
	wrapped = textwrap.wrap(text, width=MAX_CHARS) or [""]
	return [(line, 11, 0) for line in wrapped]


def build_pages(blocks: list[dict[str, object]]) -> list[list[tuple[str, int]]]:
	pages: list[list[tuple[str, int]]] = []
	current: list[tuple[str, int]] = []
	y = PAGE_HEIGHT - TOP_MARGIN

	for block in blocks:
		lines = wrap_block(block)
		needed = sum(int(math.ceil(size * 1.6)) for _, size, _ in lines)
		if current and y - needed < BOTTOM_MARGIN:
			pages.append(current)
			current = []
			y = PAGE_HEIGHT - TOP_MARGIN

		for line, size, _ in lines:
			current.append((line, size))
			y -= int(math.ceil(size * 1.6))

	if current:
		pages.append(current)

	return pages


def escape_pdf_text(value: str) -> str:
	return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def content_stream(lines: list[tuple[str, int]]) -> bytes:
	y = PAGE_HEIGHT - TOP_MARGIN
	chunks = ["BT", f"1 0 0 1 {LEFT_MARGIN} {y} Tm"]
	current_size = None

	for text, size in lines:
		leading = int(math.ceil(size * 1.6))
		if current_size != size:
			chunks.append(f"/F1 {size} Tf")
			current_size = size
		safe = escape_pdf_text(text)
		chunks.append(f"({safe}) Tj")
		chunks.append(f"0 -{leading} Td")

	chunks.append("ET")
	return "\n".join(chunks).encode("latin-1", "ignore")


def pdf_object(number: int, body: bytes) -> bytes:
	return f"{number} 0 obj\n".encode("ascii") + body + b"\nendobj\n"


def write_pdf(title: str, markdown_path: Path, pdf_path: Path) -> None:
	blocks = parse_markdown(markdown_path.read_text(encoding="utf-8"))
	pages = build_pages(blocks)

	objects: list[bytes] = []
	objects.append(pdf_object(1, b"<< /Type /Catalog /Pages 2 0 R >>"))

	kids = []
	page_ids = []
	content_ids = []
	next_id = 3
	for _ in pages:
		page_ids.append(next_id)
		kids.append(f"{next_id} 0 R")
		next_id += 1
		content_ids.append(next_id)
		next_id += 1

	objects.append(pdf_object(2, f"<< /Type /Pages /Count {len(pages)} /Kids [{' '.join(kids)}] >>".encode("ascii")))
	objects.append(pdf_object(next_id, b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>"))
	font_id = next_id

	for page_id, content_id, lines in zip(page_ids, content_ids, pages):
		stream = content_stream(lines)
		page_body = (
			f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_WIDTH} {PAGE_HEIGHT}] "
			f"/Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_id} 0 R >>"
		).encode("ascii")
		objects.append(pdf_object(page_id, page_body))
		content_body = b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream"
		objects.append(pdf_object(content_id, content_body))

	info_id = font_id + 1
	info_body = f"<< /Title ({escape_pdf_text(title)}) /Producer (Copilot stdlib PDF exporter) >>".encode("latin-1")
	objects.append(pdf_object(info_id, info_body))

	header = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
	offsets = [0]
	pdf = bytearray(header)
	for obj in sorted(objects, key=lambda chunk: int(chunk.split(b" ", 1)[0])):
		offsets.append(len(pdf))
		pdf.extend(obj)

	xref_start = len(pdf)
	count = len(offsets)
	pdf.extend(f"xref\n0 {count}\n".encode("ascii"))
	pdf.extend(b"0000000000 65535 f \n")
	for offset in offsets[1:]:
		pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))

	trailer = f"trailer\n<< /Size {count} /Root 1 0 R /Info {info_id} 0 R >>\nstartxref\n{xref_start}\n%%EOF\n"
	pdf.extend(trailer.encode("ascii"))
	pdf_path.write_bytes(pdf)


def main() -> None:
	base = Path(__file__).resolve().parent
	jobs = [
		("Minarealm Project Plan", base / "PLANS.md", base / "Minarealm_Project_Plan.pdf"),
		("Cynthia Meeting Brief", base / "CYNTHIA_MEETING_BRIEF.md", base / "Cynthia_Meeting_Brief.pdf"),
	]
	for title, src, dest in jobs:
		write_pdf(title, src, dest)
		print(dest)


if __name__ == "__main__":
	main()
