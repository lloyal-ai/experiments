import { EventEmitter } from 'node:events';
/** Ordinary application control at async boundaries. In-flight HTTP work may continue during Hold. */
export class RunControl {
 readonly abort=new AbortController();
 readonly changes=new EventEmitter();
 readonly agents=new Map<number,AbortController>();
 paused=false; closing=false; pausedAt=0; pausedMs=0;
 pause(){if(this.paused||this.closing)return;this.paused=true;this.pausedAt=performance.now();this.changes.emit('pause');}
 resume(){if(!this.paused)return 0;const ms=performance.now()-this.pausedAt;this.pausedMs+=ms;this.paused=false;this.changes.emit('resume');return ms;}
 close(){this.closing=true;this.resume();this.changes.emit('close');}
 stop(){this.abort.abort(new Error('Run stopped'));this.resume();}
 elapsed(){return performance.now()-this.pausedMs-(this.paused?performance.now()-this.pausedAt:0);}
 /** Wall-clock inquiry budget excludes deliberate Hold; HTTP execution is still ordinary async. */
 deadline(limit:number,started:number,expire:()=>void){
  let timer:ReturnType<typeof setTimeout>|undefined;
  const clear=()=>{if(timer)clearTimeout(timer);timer=undefined;};
  const arm=()=>{clear();if(!this.paused)timer=setTimeout(expire,Math.max(1,limit-(this.elapsed()-started)));};
  this.changes.on('pause',clear);this.changes.on('resume',arm);arm();
  return ()=>{clear();this.changes.off('pause',clear);this.changes.off('resume',arm);};
 }
 cancel(id:number){const a=this.agents.get(id);if(!a)throw new Error('Agent is not active');a.abort(new Error('user_cancel'));}
 async boundary(signal:AbortSignal){signal.throwIfAborted();if(!this.paused)return;await new Promise<void>((resolve,reject)=>{const resume=()=>{cleanup();resolve();};const abort=()=>{cleanup();reject(signal.reason);};const cleanup=()=>{this.changes.off('resume',resume);signal.removeEventListener('abort',abort);};this.changes.once('resume',resume);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});signal.throwIfAborted();}
}
