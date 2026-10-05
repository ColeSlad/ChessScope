import { it, expect } from 'vitest';
import { DEFAULT_POSITION } from 'chess.js';
import { validateExplanations } from '../src/main/cloud';
import { legalCandidate } from '../src/core/position';
import type { EngineAnalysis } from '../src/shared/contracts';
const analysis:EngineAnalysis={sessionId:'s',revision:3,candidates:[legalCandidate(DEFAULT_POSITION,'e2e4',{type:'cp',value:20},15,['e2e4','e7e5'])],elapsedMs:1000,terminal:null};
const valid={candidates:[{candidateId:'e2e4',explanation:'Occupies the center.',reply:'e7e5',benefit:'Creates space.',drawback:'The pawn may become a target.'}]};
it('binds structured explanation to engine evidence and revision',()=>expect(validateExplanations(valid,analysis)[0]).toMatchObject({candidateId:'e2e4',sessionId:'s',revision:3,reply:'e7e5'}));
it.each([{candidates:[]},{candidates:[{...valid.candidates[0],reply:'e7e6'}]},{candidates:[{...valid.candidates[0],candidateId:'d2d4'}]},{candidates:[{...valid.candidates[0],explanation:'Wins via a2a5.'}]},{candidates:[valid.candidates[0],valid.candidates[0]]},{candidates:[{...valid.candidates[0],unknown:'ignored'}]}])('rejects malformed or unsupported explanation %j',output=>expect(()=>validateExplanations(output,analysis)).toThrow());
