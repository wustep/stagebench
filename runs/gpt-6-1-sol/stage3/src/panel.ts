import {phase3Functional,phase3Value,phase3Text,phase3Change} from './phase3-panel'
import {focusedEffects,effectChains} from './system'
import {effectTypes,editEffect,focusLayer,pianoTypes,timbres,type InstrumentState,type UnitId,type Effect} from './instrument'
const fields:Record<string,[UnitId,keyof Effect]>={
'effects-mod-1-rate':['mod1','rate'],'effects-mod-1-amount':['mod1','amount'],'effects-mod-1-type':['mod1','type'],'effects-mod-1-on':['mod1','on'],
'effects-mod-2-rate':['mod2','rate'],'effects-mod-2-amount':['mod2','amount'],'effects-mod-2-type':['mod2','type'],'effects-mod-2-on':['mod2','on'],
'effects-delay-time':['delay','rate'],'effects-delay-feedback':['delay','feedback'],'effects-delay-on':['delay','on'],
'effects-eq-bass':['ampEq','bass'],'effects-eq-mid':['ampEq','mid'],'effects-eq-treble':['ampEq','treble'],'effects-amp-model':['ampEq','type'],'effects-amp-eq-on':['ampEq','on'],
'effects-compressor-amount':['compressor','amount'],'effects-compressor-dry-wet':['compressor','wet'],'effects-compressor-mode':['compressor','fast'],'effects-compressor-on':['compressor','on'],
'effects-reverb-amount':['reverb','wet'],'effects-reverb-tone':['reverb','tone'],'effects-reverb-type':['reverb','type'],'effects-reverb-on':['reverb','on']}
export function functional(id:string){return phase3Functional(id)||id.startsWith('piano-')||id in fields||['performance-master-level','performance-pitch-stick','performance-rotary-drive','performance-rotary-on','performance-rotary-slow-fast','effects-piano-focus','effects-organ-focus','effects-synth-focus','effects-effects-on','effects-delay-tap'].includes(id)}
export function panelValue(s:InstrumentState,id:string):number {
 if(phase3Functional(id))return phase3Value(s,id)
 const l=s.layers[s.focus],f=focusedEffects(s)
 if(id==='performance-master-level')return s.master*100
 if(id==='performance-pitch-stick')return (s.pitch+1)*50
 if(id==='performance-rotary-drive')return s.rotary.drive*100
 if(id==='performance-rotary-on')return s.rotary.on?100:0
 if(id==='performance-rotary-slow-fast')return s.rotary.fast?100:0
 if(id==='effects-effects-on')return s.effectsOn?100:0
 if(id.endsWith('-focus'))return s.fxSection===id.split('-')[1].replace(/^./,c=>c.toUpperCase())?100:0
 if(id==='piano-layer-a-level'||id==='piano-layer-b-level')return s.layers[id.includes('-a-')?'A':'B'].level*100
 if(id==='piano-layer-a-on'||id==='piano-layer-b-on')return s.layers[id.includes('-a-')?'A':'B'].enabled?100:0
 if(id==='piano-piano-on')return s.on?100:0
 if(id==='piano-sustain-pedal')return l.sustped?100:0
 if(id==='piano-pitch-stick-routing')return l.pstick?100:0
 if(id==='piano-soft-release')return l.softRelease?100:0
 if(id==='piano-string-resonance')return l.stringRes?100:0
 if(id==='piano-piano-type')return pianoTypes.indexOf(l.type)/5*100
 if(id==='piano-kb-touch')return l.touch*50
 if(id==='piano-dyn-comp')return l.dynComp/3*100
 if(id==='piano-unison')return l.unison/3*100
 if(id==='piano-timbre')return l.timbre/(timbres(l.type).length-1)*100
 if(id==='piano-octave-shift')return (l.octave+12)/24*100
 if(id==='piano-model-selector')return l.modelPosition
 if(id==='effects-delay-tap')return s.tapIndicator?100:0
 const mapping=fields[id];if(mapping){const [unit,key]=mapping,v=f[unit][key];if(typeof v==='boolean')return v?100:0;if(key==='type')return v/((effectTypes[unit as keyof typeof effectTypes]?.length??2)-1)*100;if(['bass','mid','treble'].includes(key))return (Number(v)+15)/30*100;if(key==='rate'&&f[unit].sync)return (f[unit].division-.5)/5.5*100;if(key==='rate')return unit==='delay'?(Number(v)-.025)/2.775*100:(Number(v)-.1)/9.9*100;return Number(v)*100}
 return 0
}
export function panelText(s:InstrumentState,id:string){if(phase3Functional(id))return phase3Text(s,id);const l=s.layers[s.focus],mapping=fields[id];if(mapping){const [u,k]=mapping;const e=focusedEffects(s)[u];if(k==='type')return effectTypes[u as keyof typeof effectTypes][e.type];if(k==='on')return e.on?'On':'Bypass';if(k==='fast')return e.fast?'Fast':'Normal';return String(e[k])}
 const texts:Record<string,string>={'piano-piano-type':l.type,'piano-kb-touch':['Heavy','Medium','Light'][l.touch],'piano-dyn-comp':['Off','1','2','3'][l.dynComp],'piano-unison':['Off','1','2','3'][l.unison],'piano-timbre':timbres(l.type)[l.timbre],'piano-octave-shift':`${l.octave} semitones`,'piano-model-selector':'One bundled model per type'};return texts[id]??String(Math.round(panelValue(s,id)))
}
export function changePanel(s:InstrumentState,id:string,value:number,shift=false){
 if(phase3Functional(id)){phase3Change(s,id,value);return}
 const l=s.layers[s.focus],v=Math.max(0,Math.min(100,value))/100
 if(id==='performance-master-level')s.master=v
 else if(id==='performance-pitch-stick')s.pitch=v*2-1
 else if(id==='performance-rotary-drive')s.rotary.drive=v
 else if(id==='performance-rotary-on')s.rotary.on=!s.rotary.on
 else if(id==='performance-rotary-slow-fast'){s.rotary.fast=!s.rotary.fast;s.rotary.speed=Number(s.rotary.fast);s.rotary.stop=false}
 else if(id==='piano-piano-on')s.on=!s.on
 else if(id==='piano-layer-a-on'||id==='piano-layer-b-on'){const target=id.includes('-a-')?'A':'B';s.layers[target].enabled=!s.layers[target].enabled;focusLayer(s,target)}
 else if(id==='piano-layer-a-level'||id==='piano-layer-b-level'){const target=id.includes('-a-')?'A':'B';s.layers[target].level=v;focusLayer(s,target)}
 else if(id==='piano-sustain-pedal')l.sustped=!l.sustped
 else if(id==='piano-pitch-stick-routing')l.pstick=!l.pstick
 else if(id==='piano-soft-release')l.softRelease=!l.softRelease
 else if(id==='piano-string-resonance')l.stringRes=!l.stringRes
 else if(id==='piano-model-selector')l.modelPosition=value
 else if(id==='piano-piano-type'){l.type=pianoTypes[(pianoTypes.indexOf(l.type)+1)%6];l.timbre=0}
 else if(id==='piano-kb-touch')l.touch=(l.touch+1)%3
 else if(id==='piano-dyn-comp')l.dynComp=(l.dynComp+1)%4
 else if(id==='piano-unison')l.unison=(l.unison+1)%4
 else if(id==='piano-timbre')l.timbre=(l.timbre+1)%timbres(l.type).length
 else if(id==='piano-octave-shift')l.octave=l.octave===12?-12:l.octave+12
 else if(id==='effects-effects-on')s.effectsOn=!s.effectsOn
 else if(id.endsWith('-focus'))s.fxSection=id.split('-')[1].replace(/^./,c=>c.toUpperCase()) as InstrumentState['fxSection']
 else if(fields[id]){
  const [u,k]=fields[id],e=focusedEffects(s)[u]
  if(shift&&k==='on'&&['delay','compressor','reverb'].includes(u)){const unit=u as keyof typeof s.globals;s.globals[unit]=!s.globals[unit];if(s.globals[unit]){for(const chain of effectChains(s))chain[u]={...e}}return}
  let next:number|boolean=v
  if(k==='type')next=(e.type+1)%effectTypes[u as keyof typeof effectTypes].length
  else if(k==='on'||k==='fast')next=!e[k]
  else if(['bass','mid','treble'].includes(k))next=v*30-15
  else if(k==='rate'){if(e.sync){editEffect(s,u,{division:[.5,1,1.5,2,3,4,6][Math.round(v*6)]});return}next=u==='delay'?.025+v*2.775:.1+v*9.9}
  editEffect(s,u,{[k]:next})
 }
}
