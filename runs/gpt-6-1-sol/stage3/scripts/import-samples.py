"""Fetch byte-identical recordings, pinning publisher trees. Run only when importing assets."""
import concurrent.futures, hashlib, json, pathlib, re, urllib.request, urllib.parse
root=pathlib.Path(__file__).resolve().parents[1]
out=root/'public/samples'
out.mkdir(parents=True,exist_ok=True)
models=[('Grand','sfzinstruments/SalamanderGrandPiano','master','grand-tree.json','CC-BY-3.0','Alexander Holm'),('Upright','freepats/upright-piano-KW','main','upright-tree.json','CC0-1.0','Gonzalo and Roberto / FreePats'),('Electric','sfzinstruments/GregSullivan.E-Pianos','master','sample-tree.json','CC-BY-3.0','Greg Sullivan; SFZ mapping by kinwie')]
entries=[]
def midi(name):
    m=re.match(r'([A-Ga-g])([#b]?)(\d)',name)
    return (int(m[3])+1)*12+{'c':0,'d':2,'e':4,'f':5,'g':7,'a':9,'b':11}[m[1].lower()]+{'':0,'#':1,'b':-1}[m[2]]
for kind,repo,branch,treefile,license,author in models:
    tree=json.loads((root/'scripts/source-trees'/treefile).read_text()); commit=tree['sha']
    base='https://raw.githubusercontent.com/'+repo+'/'+commit+'/'
    folder=out/kind.lower();folder.mkdir(exist_ok=True)
    for doc in ['LICENSE','README.md']:
        (folder/doc).write_bytes(urllib.request.urlopen(base+doc).read())
    for f in tree['tree']:
        path=f['path'];name=path.split('/')[-1]
        if kind=='Grand':
            m=re.fullmatch(r'([A-G]#?\d)v(4|9|14)\.flac',name)
            if not m or not path.startswith('Samples/') or not 27<=midi(m[1])<=102:continue
            note=midi(m[1]); vel={'4':(1,48),'9':(49,95),'14':(96,127)}[m[2]]
        elif kind=='Upright':
            m=re.fullmatch(r'([A-G]#?\d)v([LH])\.flac',name)
            if not m or not path.startswith('samples/') or not 24<=midi(m[1])<=108:continue
            note=midi(m[1]);vel=(1,79) if m[2]=='L' else (80,127)
        else:
            if not path.startswith('Wurlitzer EP200/Samples/') or not name.endswith('.flac'):continue
            note=midi(name);dynamic=re.search(r'(pp|mp|ff|f)\.flac',name)[1];vel={'pp':(1,37),'mp':(38,65),'f':(66,89),'ff':(90,127)}[dynamic]
        entries.append(dict(type=kind,file='samples/'+kind.lower()+'/'+name.replace('#','s'),rootNote=note,velocityLow=vel[0],velocityHigh=vel[1],originalFile=path,source=base+urllib.parse.quote(path),license=license,author=author,modifications='None; byte-identical original FLAC recording'))
def download(entry):
    p=root/'public'/entry['file']
    if not p.exists():
        p.write_bytes(urllib.request.urlopen(entry['source'],timeout=90).read())
    data=p.read_bytes()
    if not data.startswith(b'fLaC'):raise ValueError('Not FLAC: '+str(p))
    name=entry['originalFile'].split('/')[-1]
    entry['recordedVelocityLayer']=('v'+re.search(r'v(\d+)\.',name)[1]) if entry['type']=='Grand' else ('High' if 'vH.' in name else 'Low') if entry['type']=='Upright' else re.search(r'(pp|mp|ff|f)\.',name)[1]
    entry['sha256']=hashlib.sha256(data).hexdigest();entry['bytes']=len(data)
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:list(pool.map(download,entries))
(out/'manifest.json').write_text(json.dumps(entries,indent=2)+'\n')
print('Bundled',len(entries),'recordings;',sum(e['bytes'] for e in entries),'bytes')
