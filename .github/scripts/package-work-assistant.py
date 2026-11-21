"""Create the complete Work Assistant installation with reproducible ZIP metadata."""

import json
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


def package(dist: Path, destination: Path) -> Path:
    manifest = json.loads((dist / "manifest.json").read_text(encoding="utf-8"))
    plugin_id = manifest["id"]
    if plugin_id != "obsidian-work-assistant":
        raise ValueError("Unexpected plugin ID in the release build")

    required = (
        "main.js",
        "manifest.json",
        "styles.css",
        "bin/SMTCBridge.cs",
        "bin/SMTCBridge.exe",
        "periodic_note_templates/Daily.md",
        "periodic_note_templates/Weekly.md",
        "periodic_note_templates/Monthly.md",
        "periodic_note_templates/Quarterly.md",
        "periodic_note_templates/Yearly.md",
    )
    files = {dist / name for name in required}
    for path in sorted(files):
        if not path.is_file() or path.stat().st_size == 0:
            raise ValueError(f"Missing or empty installation file: {path}")

    for folder in ("bin", "periodic_note_templates"):
        files.update(path for path in (dist / folder).rglob("*") if path.is_file())

    def archive_name(file: Path) -> str:
        return f"{plugin_id}/{file.relative_to(dist).as_posix()}"

    target = destination / f"{plugin_id}-{manifest['version']}.zip"
    with ZipFile(target, mode="x", compression=ZIP_DEFLATED) as archive:
        for file in sorted(files, key=archive_name):
            entry = ZipInfo(archive_name(file), date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, file.read_bytes(), compress_type=ZIP_DEFLATED)

    with ZipFile(target) as archive:
        if archive.testzip() or set(archive.namelist()) != {archive_name(file) for file in files}:
            raise ValueError("The installation ZIP does not match the verified build")
    return target


if __name__ == "__main__":
    print(package(Path(sys.argv[1]), Path(sys.argv[2])))
