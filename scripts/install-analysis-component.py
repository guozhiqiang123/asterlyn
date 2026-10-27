#!/usr/bin/env python3
"""Explicit offline installation of a publisher-verified standalone analysis distribution."""
import argparse, hashlib, json, os, pathlib, re, shutil, tarfile, tempfile, zipfile
p=argparse.ArgumentParser();p.add_argument('--archive',required=True);p.add_argument('--sha256',required=True);p.add_argument('--id',required=True);p.add_argument('--version',required=True);p.add_argument('--store',required=True);a=p.parse_args()
if not re.fullmatch(r'[a-z][a-z0-9.-]{0,127}',a.id) or not re.fullmatch(r'[A-Za-z0-9._+-]{1,128}',a.version) or a.version in ('.','..') or not re.fullmatch('[0-9a-f]{64}',a.sha256):raise SystemExit('invalid component identity')
archive=pathlib.Path(a.archive).resolve();digest=hashlib.sha256(archive.read_bytes()).hexdigest()
if digest!=a.sha256:raise SystemExit('archive checksum mismatch')
base=pathlib.Path(a.store).resolve();base.mkdir(parents=True,exist_ok=True);parent=base/a.id/a.version;parent.mkdir(parents=True,exist_ok=True);destination=parent/digest
if destination.exists():raise SystemExit('component already exists; verify its receipt instead of replacing it')
with tempfile.TemporaryDirectory(prefix='.component-',dir=parent) as temp:
 root=pathlib.Path(temp);content=root/'content';content.mkdir()
 if zipfile.is_zipfile(archive):
  with zipfile.ZipFile(archive) as z:
   entries=z.infolist()
   if len(entries)>20000 or sum(m.file_size for m in entries)>1024**3:raise SystemExit('component exceeds extraction bounds')
   for m in entries:
    path=pathlib.PurePosixPath(m.filename)
    if path.is_absolute() or '..' in path.parts or (m.external_attr >> 16)&0o170000==0o120000 or m.file_size>256*1024**2:raise SystemExit('unsafe component archive entry')
    target=content.joinpath(*path.parts)
    if m.is_dir():target.mkdir(parents=True,exist_ok=True)
    else:
     target.parent.mkdir(parents=True,exist_ok=True)
     with z.open(m) as source,target.open('xb') as output:shutil.copyfileobj(source,output)
     target.chmod(0o555 if (m.external_attr>>16)&0o111 else 0o444)
 else:
  with tarfile.open(archive) as t:
   members=t.getmembers()
   if len(members)>20000 or sum(m.size for m in members)>1024**3:raise SystemExit('component exceeds extraction bounds')
   for m in members:
    path=pathlib.PurePosixPath(m.name)
    if path.is_absolute() or '..' in path.parts or not (m.isfile() or m.isdir()) or m.size>256*1024**2:raise SystemExit('unsafe component archive entry')
   for m in members:
    target=content.joinpath(*pathlib.PurePosixPath(m.name).parts)
    if m.isdir():target.mkdir(parents=True,exist_ok=True)
    else:
     target.parent.mkdir(parents=True,exist_ok=True)
     with t.extractfile(m) as source,target.open('xb') as output:shutil.copyfileobj(source,output)
     target.chmod(0o555 if m.mode&0o111 else 0o444)
 files=[]
 for f in sorted(content.rglob('*'),key=lambda f:f.relative_to(content).as_posix().encode()):
  if f.is_file():
   data=f.read_bytes();files.append(dict(path=f.relative_to(content).as_posix(),bytes=len(data),sha256='sha256:'+hashlib.sha256(data).hexdigest()));f.chmod(0o444 | (0o111 if f.stat().st_mode & 0o111 else 0))
 inventory=json.dumps(files,separators=(',',':'),ensure_ascii=False).encode();content_digest='sha256:'+hashlib.sha256(b'analysis-component-v1\0'+inventory).hexdigest()
 receipt=dict(schema=1,id=a.id,version=a.version,archiveDigest='sha256:'+digest,contentDigest=content_digest,files=files)
 (root/'receipt.json').write_text(json.dumps(receipt,separators=(',',':'))+'\n');os.rename(root,destination)
 print(json.dumps(dict(id=a.id,version=a.version,archiveDigest='sha256:'+digest,contentDigest=content_digest,files=len(files),bytes=sum(f['bytes'] for f in files))))
