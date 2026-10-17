"""Record the converted model's tensor types and source/converter provenance."""
import collections
import hashlib
import json
import pathlib
import subprocess
import sys

converter = pathlib.Path("work/upstream/llama.cpp")
sys.path.insert(0, str(converter / "gguf-py"))
from gguf import GGUFReader

def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

model = pathlib.Path("models/llm/Qwen3.5-4B-BF16.gguf")
reader = GGUFReader(str(model))
metadata = {}
for key, field in reader.fields.items():
    if key.startswith(("general.", "qwen35.", "tokenizer.chat_template")):
        value = field.contents()
        if key == "tokenizer.chat_template":
            metadata[key + ".sha256"] = hashlib.sha256(value.encode()).hexdigest()
        elif isinstance(value, (str, int, float, bool)):
            metadata[key] = value

types = dict(collections.Counter(t.tensor_type.name for t in reader.tensors))
if "BF16" not in types or set(types) - {"BF16", "F32"}:
    raise ValueError("Unexpected tensor precision: " + str(types))

source = pathlib.Path("models/source/Qwen3.5-4B")
receipt = {
    "source": {"repository": "Qwen/Qwen3.5-4B", "revision": "851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a",
               "files": {p.name: sha(p) for p in sorted(source.iterdir()) if p.is_file()}},
    "converter": {"repository": "ggml-org/llama.cpp",
                  "revision": subprocess.check_output(["git", "-C", str(converter), "rev-parse", "HEAD"], text=True).strip(),
                  "command": "convert_hf_to_gguf.py models/source/Qwen3.5-4B --outtype bf16 --outfile models/llm/Qwen3.5-4B-BF16.gguf",
                  "packages": subprocess.check_output([sys.executable, "-m", "pip", "freeze"], text=True).splitlines()},
    "model": {"path": str(model), "bytes": model.stat().st_size, "sha256": sha(model),
              "tensorTypes": types, "metadata": metadata}
}
path = pathlib.Path("work/provision/model-receipt.json")
with path.open("x") as f:
    json.dump(receipt, f, indent=2)
print(json.dumps({"receipt": str(path), "model": receipt["model"]}, indent=2))
