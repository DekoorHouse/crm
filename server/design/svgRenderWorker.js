'use strict';
const { parentPort, workerData } = require('worker_threads');
try { parentPort.postMessage({ok:true,result:require('./svgRenderer').generateSheet(workerData)}); }
catch(e){parentPort.postMessage({ok:false,error:{message:e.message,code:e.code||'RENDER_FAILED',lampIndices:e.lampIndices||[]}});}
