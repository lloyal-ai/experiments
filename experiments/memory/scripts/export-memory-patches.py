"""Preserve reviewable source deltas from isolated instrumentation checkouts."""
import json, subprocess, hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[1]; out=root/'instrumentation/patches';out.mkdir(exist_ok=True)
sources={}
for label,sub in [('lloyal-node','lloyal-node'),('liblloyal','lloyal-node/liblloyal'),('llama.cpp','lloyal-node/llama.cpp')]:
    repo=root/'instrumentation'/sub
    def git(*args):return subprocess.check_output(['git',*args],cwd=repo)
    patch=git('diff','--binary','--ignore-submodules=all')
    for name in git('ls-files','--others','--exclude-standard').decode().splitlines():
        if name.startswith('src/'):
            r=subprocess.run(['git','diff','--no-index','--binary','--','/dev/null',name],cwd=repo,stdout=subprocess.PIPE)
            if r.returncode not in [0,1]:raise RuntimeError(name)
            patch+=r.stdout
    (out/(label+'.patch')).write_bytes(patch)
    sources[label]={'path':str(repo),'head':git('rev-parse','HEAD').decode().strip(),'branch':git('branch','--show-current').decode().strip(),'patchSha256':hashlib.sha256(patch).hexdigest()}
(out/'sources.json').write_text(json.dumps(sources,indent=2)+'\n')
