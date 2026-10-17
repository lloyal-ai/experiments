"""Extract AA-LCR without changing source bytes or misreading unflagged UTF-8 names."""
import json
import pathlib
import stat
import sys
import unicodedata
import zipfile

def entry_name(info):
    if info.flag_bits & 0x800:
        return info.filename
    raw = info.filename.encode("cp437")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return info.filename

def extract(archive, destination):
    root = pathlib.Path(destination).resolve()
    root.mkdir(parents=True, exist_ok=False)
    seen = set()
    renamed = []
    with zipfile.ZipFile(archive) as source:
        for info in source.infolist():
            name = unicodedata.normalize("NFC", entry_name(info))
            target = (root / name).resolve()
            if root not in target.parents or name in seen:
                raise ValueError("Unsafe or duplicate archive path: " + name)
            if stat.S_ISLNK(info.external_attr >> 16):
                raise ValueError("Symlinks are not source documents")
            seen.add(name)
            if name != info.filename:
                renamed.append({"archive": info.filename, "decoded": name})
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("xb") as output:
                    output.write(source.read(info))
    return {"entries": len(seen), "filenameDecodings": renamed}

if __name__ == "__main__":
    print(json.dumps(extract(sys.argv[1], sys.argv[2]), ensure_ascii=False, indent=2))
