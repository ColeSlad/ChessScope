import { CloudAI } from '../src/main/cloud';
import { visionSchema, aiSettingSchema, type Orientation } from '../src/shared/contracts';
import { importPosition, matchObservation, placementKey, placementsOf } from '../src/core/position';
import { Stockfish } from '../src/main/engine';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
type Fixture = { id: string; orientation: Orientation; beforeFen: string | null; expectedFen: string | null; expectsCorrection: boolean };
export async function evaluate(fixture: Fixture, bytes: Buffer) {
  const started=performance.now(),sessionId=randomUUID(),revision=0;
  const setting=aiSettingSchema.parse({model:process.env.RECOGNITION_MODEL??'gpt-6.1-sol',effort:process.env.RECOGNITION_EFFORT??'low'});
  let engine: Stockfish | null=null;
  try{
    const cloud=new CloudAI(()=>process.env.OPENAI_API_KEY);
    const observation=visionSchema.parse(await cloud.recognize({sessionId,revision,frameId:0,image:`data:image/jpeg;base64,${bytes.toString('base64')}`,signature:Array(4096).fill(0),sourceWidth:1024,sourceHeight:1024},fixture.orientation,setting,new AbortController().signal));
    let correction=!observation.boardVisible||!observation.cropAligned||observation.uncertainSquares.length>0||observation.orientation!==fixture.orientation;
    if(fixture.beforeFen){const position=importPosition({sessionId,revision,format:'fen',text:fixture.beforeFen,coachedSide:'w',orientation:fixture.orientation,confirmed:true},revision);const match=matchObservation(position,observation);correction ||= match.kind==='correction';if(!correction&&match.kind==='move'){const dir=path.resolve('resources/stockfish');engine=new Stockfish(path.join(dir,'stockfish'),dir);await engine.analyze(match.position,new AbortController().signal);}}
    const correct=!!fixture.expectedFen && placementKey(observation.placements)===placementKey(placementsOf(fixture.expectedFen));
    return {id:fixture.id,outcome:correction?'correction':fixture.expectsCorrection?'incorrect':correct?'correct':'incorrect',latencyMs:performance.now()-started};
  }catch{return{id:fixture.id,outcome:'error',latencyMs:null};}finally{engine?.shutdown();}
}
