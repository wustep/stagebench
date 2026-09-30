import {hardware} from './hardware'
import type {InstrumentState} from './instrument'
export function controlMorphPath(s:InstrumentState,id:string):string|null{
 const drawbar=hardware.filter(c=>c.kind==='drawbar').findIndex(c=>c.id===id);if(drawbar>=0)return `organ.layers.${s.organ.focus}.drawbars.${drawbar}`
 const match=id.match(/^(piano|organ|synth)-layer-([abc])-level$/);if(match)return match[1]==='piano'?`layers.${match[2].toUpperCase()}.level`:`${match[1]}.layers.${match[2].toUpperCase()}.level`
 const paths:Record<string,string>={'synth-oscillator-control':'ctrl','synth-filter-frequency':'cutoff','synth-filter-resonance':'res','synth-lfo-rate':'lfo.rate','synth-lfo-amount':'lfo.amount','synth-arpeggiator-rate':'arp.rate'}
 if(paths[id]){const l=s.synth.layers[s.synth.focus];return `synth.layers.${s.synth.focus}.${id==='synth-lfo-rate'&&l.lfo.sync?'lfo.division':id==='synth-arpeggiator-rate'&&l.arp.sync?'arp.division':paths[id]}`}
 if(id==='performance-rotary-slow-fast')return 'rotary.speed'
 const effects:Record<string,string>={'effects-mod-1-rate':'mod1.rate','effects-mod-1-amount':'mod1.amount','effects-mod-2-amount':'mod2.amount','effects-delay-time':'delay.rate','effects-delay-feedback':'delay.feedback','effects-reverb-amount':'reverb.wet'}
 const prefix=s.fxSection==='Piano'?`layers.${s.fxFocus}.effects`:s.fxSection==='Organ'?'organ.effects':`synth.layers.${s.synth.focus}.effects`
 if(!effects[id])return null;const effectPath=effects[id];const [unit]=effectPath.split('.');const chain=s.fxSection==='Piano'?s.layers[s.fxFocus].effects:s.fxSection==='Organ'?s.organ.effects:s.synth.layers[s.synth.focus].effects;return `${prefix}.${effectPath.endsWith('.rate')&&chain[unit as 'mod1'|'delay'].sync?effectPath.replace('.rate','.division'):effectPath}`
}
