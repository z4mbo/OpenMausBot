import os,stat,shutil,json,hashlib
root="/root/origin-release-staging/0.2.15"
parts=root.split('/')
for n in range(2,len(parts)+1):
 p='/'.join(parts[:n]); s=os.lstat(p); assert stat.S_ISDIR(s.st_mode) and not stat.S_ISLNK(s.st_mode)
for name,digest in {"promote-downloads.sh":"b9550237b61204053d1446c0772e02ba45cf151a410d6e60d2d49825c25bc6ab","validate-release.py":"d555e5b03ecb6e8f8650278935b6b194af1d63e2816e7c07d8bf9f21df790567"}.items():
 p=root+'/'+name; s=os.lstat(p); assert stat.S_ISREG(s.st_mode) and not stat.S_ISLNK(s.st_mode); assert hashlib.sha256(open(p,'rb').read()).hexdigest()==digest
d=root+'/downloads'
assert not os.path.lexists(d),'Existing private download stage: reconcile, never overwrite'
assert shutil.disk_usage(root).free > 1947905994+1073741824
os.mkdir(d,0o700)
print(json.dumps({'directory':d,'created':True,'bytesExpected':1947905994,'helpersVerified':True}))
