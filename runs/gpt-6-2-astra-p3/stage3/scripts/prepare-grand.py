from pathlib import Path
import subprocess as sp
import json, array, math
pack=Path('../inputs/samples')
source=json.loads((pack/'sample-sources.json').read_text())['sampleSources'][0]
files=[]
for note in range(27,100,3):
    name=['C','','','D#','','','F#','','','A','',''][note%12]+str(note//12-1)
    for dyn in [4,10]:
        raw=Path('grand/salamander-grand-v3/Samples')/(name+'v'+str(dyn)+'.flac')
        pcm=array.array('h');pcm.frombytes(sp.check_output(['ffmpeg','-v','error','-i',str(pack/raw),'-t','10','-ar','32000','-f','s16le','-ac','2','-']))
        peak=max(abs(x) for x in pcm)
        onset=next((i//2 for i,v in enumerate(pcm) if abs(v)>peak*.008),0)
        start=max(0,onset-48)
        duration=len(pcm)/64000-start/32000
        out=Path(f'public/samples/grand-{note}-{dyn}.ogg')
        gain=.8*32767/peak
        sp.run(['ffmpeg','-v','error','-y','-i',str(pack/raw),'-ss',str(start/32000),'-t',str(duration),'-af',f'volume={gain},afade=t=out:st={duration-.6+start/32000}:d=0.6','-ar','32000','-c:a','libvorbis','-q:a','5',str(out)],check=True)
        files.append(dict(path=str(out),origin='pack',packFile=str(raw),rootNote=note,velocityLayer=dyn,processing=f'Attack trim {start/32000:.6f} s; up to 10 s, final 600 ms fade, gain {gain:.5f}, stereo 32 kHz Vorbis q5.'))
manifest=json.loads(Path('IMPLEMENTATION_DETAILS.json').read_text())
audio = manifest['audio']
audio['files'] = files + [f for f in audio['files'] if not f['path'].startswith('public/samples/grand-')]
audio['sampleSources'] = [source] + [s for s in audio['sampleSources'] if s['id'] != source['id']]
Path('IMPLEMENTATION_DETAILS.json').write_text(json.dumps(manifest,indent=2)+'\n')
