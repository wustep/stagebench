import {hardware} from './hardware'
import {organModels,waveforms,categories,setFocus,type SynthId} from './system'
import type {InstrumentState} from './instrument'
import type {PianoEngine} from './audio'
export const excludedControls:Record<string,string>={
 'organ-preset':'Organ preset library / physical drawbar preset modes excluded (organ scope)',
 'program-aftertouch-morph':'Aftertouch morph excluded (programs scope)',
 'program-monitor':'Monitor/Copy/Paste/Swap excluded (programs scope)',
}
export function phase3Functional(id:string){return !(id in excludedControls)&&(id.startsWith('organ-')||id.startsWith('synth-')||id.startsWith('program-')||['performance-modulation-wheel','performance-rotary-stop-mode','performance-rotary-source'].includes(id))}
const cycle=(v:number,count:number)=>(v+1)%count
export function phase3Value(s:InstrumentState,id:string):number{
 const o=s.organ.layers[s.organ.focus],l=s.synth.layers[s.synth.focus]
 if(id==='performance-modulation-wheel')return s.morphInput.Wheel*100
 if(id==='performance-rotary-stop-mode')return Number(s.rotary.stop)*100
 if(id==='performance-rotary-source')return Number(s.rotary.organ)*100
 if(id.startsWith('organ-drawbar-'))return o.drawbars[hardware.filter(c=>c.kind==='drawbar').findIndex(c=>c.id===id)]/8*100
 for(const section of ['organ','synth'] as const){const match=id.match(new RegExp(`^${section}-layer-([abc])-(level|on)$`));if(match){const layer=section==='organ'?s.organ.layers[match[1].toUpperCase() as 'A'|'B']:s.synth.layers[match[1].toUpperCase() as SynthId];return match[2]==='level'?layer.level*100:Number(layer.enabled)*100}}
 const organ:Record<string,number>={'organ-organ-model':organModels.indexOf(o.model)/5,'organ-vibrato-chorus':o.vib/5,'organ-vibrato-chorus-on':Number(o.vibOn),'organ-percussion-volume':Number(o.soft),'organ-percussion-decay':Number(o.fast),'organ-percussion-harmonic':Number(o.third),'organ-percussion-on':Number(o.percussion),'organ-sustain-pedal':Number(o.sustped),'organ-pitch-stick-routing':Number(o.pstick),'organ-octave-shift':(o.octave+12)/24}
 const synth:Record<string,number>={'synth-synth-on':Number(s.synth.on),'synth-layer-focus':['A','B','C'].indexOf(s.synth.focus)/2,'synth-sustain-pedal':Number(l.sustped),'synth-pitch-stick-routing':Number(l.pstick),'synth-octave-shift':(l.octave+12)/24,'synth-oscillator-select':l.wave/13,'synth-waveform':l.wave/13,'synth-oscillator-mode':['Pure','Sync','Multi','Super','FM-H'].indexOf(categories[l.wave])/4,'synth-oscillator-control':l.ctrl,'synth-oscillator-mix':(l.coarse+24)/48,'synth-oscillator-shape':(l.oscEnv.amount+1)/2,'synth-lfo-rate':l.lfo.sync?(l.lfo.division-.5)/7.5:(l.lfo.rate-.1)/19.9,'synth-lfo-amount':l.lfo.amount,'synth-lfo-waveform':l.lfo.wave/4,'synth-arpeggiator-rate':l.arp.sync?(l.arp.division-.5)/5.5:(l.arp.rate-30)/270,'synth-arpeggiator-range':(l.arp.range-1)/3,'synth-arpeggiator-on':Number(l.arp.run),'synth-arpeggiator-mode':l.arp.mode/2,'synth-arpeggiator-hold':Number(l.arp.hold),'synth-filter-frequency':Math.log(l.cutoff/20)/Math.log(1000),'synth-filter-resonance':l.res,'synth-filter-type':l.filter/3,'synth-filter-drive':l.drive/3,'synth-filter-envelope-amount':l.filterEnv.amount,'synth-filter-velocity':l.filterEnv.velocity,'synth-mono-legato':l.mode/2,'synth-unison':l.unison/3,'synth-amp-attack':l.ampEnv.attack/4,'synth-amp-decay':l.ampEnv.decay/4,'synth-amp-sustain':l.ampEnv.velocity/3,'synth-amp-release':l.ampEnv.release/4,'synth-mod-attack':l.oscEnv.attack/4,'synth-mod-decay':l.oscEnv.decay/4,'synth-mod-sustain':l.oscEnv.velocity,'synth-mod-release':l.oscEnv.release/4}
 const program:Record<string,number>={'program-wheel-morph':Number(s.morphAssign==='Wheel'),'program-control-pedal-morph':Number(s.morphAssign==='Pedal'),'program-layer-scene':s.scene,'program-split-on':Number(s.splits.on),'program-split-set':Number(s.splits.on),'program-master-clock':Number(s.tapIndicator),'program-transpose':(s.transpose+6)/12}
 return (organ[id]??synth[id]??program[id]??0)*100
}
export function phase3Text(s:InstrumentState,id:string){const o=s.organ.layers[s.organ.focus],l=s.synth.layers[s.synth.focus];const text:Record<string,string>={'organ-organ-model':o.model,'organ-vibrato-chorus':['C1','C2','C3','V1','V2','V3'][o.vib],'synth-oscillator-select':waveforms[l.wave],'synth-waveform':waveforms[l.wave],'synth-oscillator-mode':`${categories[l.wave]} · Analog`,'synth-oscillator-control':`${(l.ctrl*10).toFixed(1)}${categories[l.wave]==='Pure'?' · no effect for Pure':''}`,'synth-oscillator-mix':`${l.coarse} semitones`,'synth-oscillator-shape':`Osc Env amount ${l.oscEnv.amount.toFixed(2)}`,'synth-filter-type':['LP12','LP24','HP','BP'][l.filter],'synth-mono-legato':['Poly','Mono','Legato'][l.mode],'program-transpose':`${s.transpose} semitones; Shift = Panic`,'program-master-clock':`${s.clockBpm} BPM · tap four times; Shift opens settings`,'synth-amp-sustain':`Amp velocity ${l.ampEnv.velocity}`,'synth-mod-sustain':`Osc velocity ${l.oscEnv.velocity?'On':'Off'}`};return text[id]??String(Math.round(phase3Value(s,id)))}
export function phase3Change(s:InstrumentState,id:string,value:number){const v=Math.max(0,Math.min(1,value/100)),o=s.organ.layers[s.organ.focus],l=s.synth.layers[s.synth.focus]
 if(id==='performance-modulation-wheel')s.morphInput.Wheel=v
 else if(id==='performance-rotary-stop-mode')s.rotary.stop=!s.rotary.stop
 else if(id==='performance-rotary-source')s.rotary.organ=!s.rotary.organ
 else if(id.startsWith('organ-drawbar-'))o.drawbars[hardware.filter(c=>c.kind==='drawbar').findIndex(c=>c.id===id)]=Math.round(v*8)
 else if(/^(organ|synth)-layer-[abc]-(level|on)$/.test(id)){const [,section,letter,param]=id.match(/^(organ|synth)-layer-([abc])-(level|on)$/)!;const layerId=letter.toUpperCase() as SynthId;const layer=section==='organ'?s.organ.layers[layerId as 'A'|'B']:s.synth.layers[layerId];if(param==='level')layer.level=v;else layer.enabled=!layer.enabled;setFocus(s,section==='organ'?'Organ':'Synth',layerId)}
 else if(id==='organ-organ-model')o.model=organModels[cycle(organModels.indexOf(o.model),6)]
 else if(id==='organ-vibrato-chorus')o.vib=cycle(o.vib,6)
 else if(id==='organ-vibrato-chorus-on')o.vibOn=!o.vibOn
 else if(id==='organ-percussion-volume')o.soft=!o.soft
 else if(id==='organ-percussion-decay')o.fast=!o.fast
 else if(id==='organ-percussion-harmonic')o.third=!o.third
 else if(id==='organ-percussion-on')o.percussion=!o.percussion
 else if(id==='organ-sustain-pedal')o.sustped=!o.sustped
 else if(id==='organ-pitch-stick-routing')o.pstick=!o.pstick
 else if(id==='organ-octave-shift')o.octave=o.octave===12?-12:o.octave+12
 else if(id==='synth-synth-on')s.synth.on=!s.synth.on
 else if(id==='synth-layer-focus')setFocus(s,'Synth',(['A','B','C'] as const)[cycle(['A','B','C'].indexOf(s.synth.focus),3)])
 else if(id==='synth-sustain-pedal')l.sustped=!l.sustped
 else if(id==='synth-pitch-stick-routing')l.pstick=!l.pstick
 else if(id==='synth-octave-shift')l.octave=l.octave===12?-12:l.octave+12
 else if(id==='synth-oscillator-select')l.wave=Math.round(v*13)
 else if(id==='synth-waveform')l.wave=cycle(l.wave,14)
 else if(id==='synth-oscillator-mode')l.wave=[0,7,9,11,13][cycle(['Pure','Sync','Multi','Super','FM-H'].indexOf(categories[l.wave]),5)]
 else if(id==='synth-oscillator-control')l.ctrl=v
 else if(id==='synth-oscillator-mix')l.coarse=Math.round(v*48)-24
 else if(id==='synth-oscillator-shape')l.oscEnv.amount=v*2-1
 else if(id==='synth-lfo-rate'){if(l.lfo.sync)l.lfo.division=.5+v*7.5;else l.lfo.rate=.1+v*19.9}
 else if(id==='synth-lfo-amount')l.lfo.amount=v
 else if(id==='synth-lfo-waveform')l.lfo.wave=cycle(l.lfo.wave,5)
 else if(id==='synth-arpeggiator-rate'){if(l.arp.sync)l.arp.division=[.5,1,1.5,2,3,4,6][Math.round(v*6)];else l.arp.rate=30+v*270}
 else if(id==='synth-arpeggiator-range')l.arp.range=1+Math.round(v*3)
 else if(id==='synth-arpeggiator-on')l.arp.run=!l.arp.run
 else if(id==='synth-arpeggiator-mode')l.arp.mode=cycle(l.arp.mode,3)
 else if(id==='synth-arpeggiator-hold')l.arp.hold=!l.arp.hold
 else if(id==='synth-filter-frequency')l.cutoff=20*1000**v
 else if(id==='synth-filter-resonance')l.res=v
 else if(id==='synth-filter-type')l.filter=cycle(l.filter,4)
 else if(id==='synth-filter-drive')l.drive=cycle(l.drive,4)
 else if(id==='synth-filter-envelope-amount')l.filterEnv.amount=v
 else if(id==='synth-filter-velocity')l.filterEnv.velocity=Math.round(v)
 else if(id==='synth-mono-legato')l.mode=cycle(l.mode,3)
 else if(id==='synth-unison')l.unison=cycle(l.unison,4)
 else if(id.match(/^synth-(amp|mod)-(attack|decay|release|sustain)$/)){const [,which,field]=id.match(/^synth-(amp|mod)-(attack|decay|release|sustain)$/)!;const env=which==='amp'?l.ampEnv:l.oscEnv;if(field==='sustain')env.velocity=Math.round(v*(which==='amp'?3:1));else env[field as 'attack'|'decay'|'release']=Math.max(.001,v*4)}
}
export function programAction(e:PianoEngine,id:string,value:number,shift=false){const p=e.programs
 if(id==='program-program-dial'){if(shift){p.list=!p.list;e.changed()}else e.selectProgram(Math.round(value/100*(p.liveMode?7:31)))}
 else if(/^program-program-[1-8]$/.test(id))e.selectProgram((p.liveMode?0:Math.floor((p.store?.destination??p.selected)/8)*8)+Number(id.at(-1))-1)
 else if(id==='program-page-next'||id==='program-page-previous'){const selected=p.store?.destination??p.selected;e.selectProgram((selected+(id.endsWith('next')?8:24))%32)}
 else if(id==='program-live-mode')e.toggleLive()
 else if(id==='program-store'){if(shift&&p.store)e.cancelStore();else e.storeProgram(shift)}
 else if(id==='program-layer-scene')e.changeScene()
 else if(id==='program-master-clock')e.tapClock()
 else if(id==='program-transpose'){if(shift)e.allOff();else e.updateState(s=>{s.transpose=s.transpose===6?-6:s.transpose+1})}
 else if(id==='program-wheel-morph'||id==='program-control-pedal-morph')e.updateState(s=>{const source=id.includes('wheel')?'Wheel':'Pedal';if(shift){s.morphs[source]=[];s.morphAssign=null}else s.morphAssign=s.morphAssign===source?null:source})
 else if(id==='program-split-on')e.updateState(s=>{s.splits.on=!s.splits.on})
 else return false
 return true
}
