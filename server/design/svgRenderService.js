'use strict';
const path = require('path');
const { Worker } = require('worker_threads');
let chain=Promise.resolve();
function renderSheet(input){
    const task=chain.then(()=>new Promise((resolve,reject)=>{
        const w=new Worker(path.join(__dirname,'svgRenderWorker.js'),{workerData:input});
        let settled=false;
        const finish=(err,value)=>{if(settled)return;settled=true;clearTimeout(timer);w.terminate();err?reject(err):resolve(value);};
        const timer=setTimeout(()=>finish(new Error('El diseño excedió el tiempo de generación.')),120000);
        w.once('message',m=>m.ok?finish(null,{...m.result,preview:Buffer.from(m.result.preview)}):finish(Object.assign(new Error(m.error.message),m.error)));
        w.once('error',e=>finish(e));w.once('exit',code=>{if(!settled)finish(new Error('El generador terminó sin resultado: '+code));});
    }));
    chain=task.catch(()=>{});return task;
}
module.exports={renderSheet};
