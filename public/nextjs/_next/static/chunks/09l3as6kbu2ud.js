(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,87758,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0}),Object.defineProperty(r,"warnOnce",{enumerable:!0,get:function(){return a}});let a=e=>{}},47495,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0});var a={DecodeError:function(){return y},MiddlewareNotFoundError:function(){return w},MissingStaticPage:function(){return x},NormalizeError:function(){return b},PageNotFoundError:function(){return v},SP:function(){return g},ST:function(){return h},WEB_VITALS:function(){return n},execOnce:function(){return i},getDisplayName:function(){return d},getLocationOrigin:function(){return c},getURL:function(){return u},isAbsoluteUrl:function(){return l},isResSent:function(){return f},loadGetInitialProps:function(){return m},normalizeRepeatedSlashes:function(){return p},stringifyError:function(){return E}};for(var o in a)Object.defineProperty(r,o,{enumerable:!0,get:a[o]});let n=["CLS","FCP","FID","INP","LCP","TTFB"];function i(e){let t,r=!1;return(...a)=>(r||(r=!0,t=e(...a)),t)}let s=/^[a-zA-Z][a-zA-Z\d+\-.]*?:/,l=e=>s.test(e);function c(){let{protocol:e,hostname:t,port:r}=window.location;return`${e}//${t}${r?":"+r:""}`}function u(){let{href:e}=window.location,t=c();return e.substring(t.length)}function d(e){return"string"==typeof e?e:e.displayName||e.name||"Unknown"}function f(e){return e.finished||e.headersSent}function p(e){let t=e.split("?");return t[0].replace(/\\/g,"/").replace(/\/\/+/g,"/")+(t[1]?`?${t.slice(1).join("?")}`:"")}async function m(e,t){let r=t.res||t.ctx&&t.ctx.res;if(!e.getInitialProps)return t.ctx&&t.Component?{pageProps:await m(t.Component,t.ctx)}:{};let a=await e.getInitialProps(t);if(r&&f(r))return a;if(!a)throw Object.defineProperty(Error(`"${d(e)}.getInitialProps()" should resolve to an object. But found "${a}" instead.`),"__NEXT_ERROR_CODE",{value:"E1025",enumerable:!1,configurable:!0});return a}let g="u">typeof performance,h=g&&["mark","measure","getEntriesByName"].every(e=>"function"==typeof performance[e]);class y extends Error{}class b extends Error{}class v extends Error{constructor(e){super(),this.code="ENOENT",this.name="PageNotFoundError",this.message=`Cannot find module for page: ${e}`}}class x extends Error{constructor(e,t){super(),this.message=`Failed to load static file for page: ${e} ${t}`}}class w extends Error{constructor(){super(),this.code="ENOENT",this.message="Cannot find the middleware module"}}function E(e){return JSON.stringify({message:e.message,stack:e.stack})}},38282,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0});var a={assign:function(){return l},searchParamsToUrlQuery:function(){return n},urlQueryToSearchParams:function(){return s}};for(var o in a)Object.defineProperty(r,o,{enumerable:!0,get:a[o]});function n(e){let t={};for(let[r,a]of e.entries()){let e=t[r];void 0===e?t[r]=a:Array.isArray(e)?e.push(a):t[r]=[e,a]}return t}function i(e){return"string"==typeof e?e:("number"!=typeof e||isNaN(e))&&"boolean"!=typeof e?"":String(e)}function s(e){let t=new URLSearchParams;for(let[r,a]of Object.entries(e))if(Array.isArray(a))for(let e of a)t.append(r,i(e));else t.set(r,i(a));return t}function l(e,...t){for(let r of t){for(let t of r.keys())e.delete(t);for(let[t,a]of r.entries())e.append(t,a)}return e}},89195,e=>{"use strict";let t,r;var a,o=e.i(94611);let n={data:""},i=/(?:([\u0080-\uFFFF\w-%@]+) *:? *([^{;]+?);|([^;}{]*?) *{)|(}\s*)/g,s=/\/\*[^]*?\*\/|  +/g,l=/\n+/g,c=(e,t)=>{let r="",a="",o="";for(let n in e){let i=e[n];"@"==n[0]?"i"==n[1]?r=n+" "+i+";":a+="f"==n[1]?c(i,n):n+"{"+c(i,"k"==n[1]?"":t)+"}":"object"==typeof i?a+=c(i,t?t.replace(/([^,])+/g,e=>n.replace(/([^,]*:\S+\([^)]*\))|([^,])+/g,t=>/&/.test(t)?t.replace(/&/g,e):e?e+" "+t:t)):n):null!=i&&(n=/^--/.test(n)?n:n.replace(/[A-Z]/g,"-$&").toLowerCase(),o+=c.p?c.p(n,i):n+":"+i+";")}return r+(t&&o?t+"{"+o+"}":o)+a},u={},d=e=>{if("object"==typeof e){let t="";for(let r in e)t+=r+d(e[r]);return t}return e};function f(e){let t,r,a=this||{},o=e.call?e(a.p):e;return((e,t,r,a,o)=>{var n;let f=d(e),p=u[f]||(u[f]=(e=>{let t=0,r=11;for(;t<e.length;)r=101*r+e.charCodeAt(t++)>>>0;return"go"+r})(f));if(!u[p]){let t=f!==e?e:(e=>{let t,r,a=[{}];for(;t=i.exec(e.replace(s,""));)t[4]?a.shift():t[3]?(r=t[3].replace(l," ").trim(),a.unshift(a[0][r]=a[0][r]||{})):a[0][t[1]]=t[2].replace(l," ").trim();return a[0]})(e);u[p]=c(o?{["@keyframes "+p]:t}:t,r?"":"."+p)}let m=r&&u.g?u.g:null;return r&&(u.g=u[p]),n=u[p],m?t.data=t.data.replace(m,n):-1===t.data.indexOf(n)&&(t.data=a?n+t.data:t.data+n),p})(o.unshift?o.raw?(t=[].slice.call(arguments,1),r=a.p,o.reduce((e,a,o)=>{let n=t[o];if(n&&n.call){let e=n(r),t=e&&e.props&&e.props.className||/^go/.test(e)&&e;n=t?"."+t:e&&"object"==typeof e?e.props?"":c(e,""):!1===e?"":e}return e+a+(null==n?"":n)},"")):o.reduce((e,t)=>Object.assign(e,t&&t.call?t(a.p):t),{}):o,(e=>{if("object"==typeof window){let t=(e?e.querySelector("#_goober"):window._goober)||Object.assign(document.createElement("style"),{innerHTML:" ",id:"_goober"});return t.nonce=window.__nonce__,t.parentNode||(e||document.head).appendChild(t),t.firstChild}return e||n})(a.target),a.g,a.o,a.k)}f.bind({g:1});let p,m,g,h=f.bind({k:1});function y(e,t){let r=this||{};return function(){let a=arguments;function o(n,i){let s=Object.assign({},n),l=s.className||o.className;r.p=Object.assign({theme:m&&m()},s),r.o=/ *go\d+/.test(l),s.className=f.apply(r,a)+(l?" "+l:""),t&&(s.ref=i);let c=e;return e[0]&&(c=s.as||e,delete s.as),g&&c[0]&&g(s),p(c,s)}return t?t(o):o}}var b=(e,t)=>"function"==typeof e?e(t):e,v=(t=0,()=>(++t).toString()),x=()=>{if(void 0===r&&"u">typeof window){let e=matchMedia("(prefers-reduced-motion: reduce)");r=!e||e.matches}return r},w="default",E=(e,t)=>{let{toastLimit:r}=e.settings;switch(t.type){case 0:return{...e,toasts:[t.toast,...e.toasts].slice(0,r)};case 1:return{...e,toasts:e.toasts.map(e=>e.id===t.toast.id?{...e,...t.toast}:e)};case 2:let{toast:a}=t;return E(e,{type:+!!e.toasts.find(e=>e.id===a.id),toast:a});case 3:let{toastId:o}=t;return{...e,toasts:e.toasts.map(e=>e.id===o||void 0===o?{...e,dismissed:!0,visible:!1}:e)};case 4:return void 0===t.toastId?{...e,toasts:[]}:{...e,toasts:e.toasts.filter(e=>e.id!==t.toastId)};case 5:return{...e,pausedAt:t.time};case 6:let n=t.time-(e.pausedAt||0);return{...e,pausedAt:void 0,toasts:e.toasts.map(e=>({...e,pauseDuration:e.pauseDuration+n}))}}},k=[],C={toasts:[],pausedAt:void 0,settings:{toastLimit:20}},P={},O=(e,t=w)=>{P[t]=E(P[t]||C,e),k.forEach(([e,r])=>{e===t&&r(P[t])})},D=e=>Object.keys(P).forEach(t=>O(e,t)),A=(e=w)=>t=>{O(t,e)},S={blank:4e3,error:4e3,success:2e3,loading:1/0,custom:4e3},T=(e={},t=w)=>{let[r,a]=(0,o.useState)(P[t]||C),n=(0,o.useRef)(P[t]);(0,o.useEffect)(()=>(n.current!==P[t]&&a(P[t]),k.push([t,a]),()=>{let e=k.findIndex(([e])=>e===t);e>-1&&k.splice(e,1)}),[t]);let i=r.toasts.map(t=>{var r,a,o;return{...e,...e[t.type],...t,removeDelay:t.removeDelay||(null==(r=e[t.type])?void 0:r.removeDelay)||(null==e?void 0:e.removeDelay),duration:t.duration||(null==(a=e[t.type])?void 0:a.duration)||(null==e?void 0:e.duration)||S[t.type],style:{...e.style,...null==(o=e[t.type])?void 0:o.style,...t.style}}});return{...r,toasts:i}},j=e=>(t,r)=>{let a,o=((e,t="blank",r)=>({createdAt:Date.now(),visible:!0,dismissed:!1,type:t,ariaProps:{role:"status","aria-live":"polite"},message:e,pauseDuration:0,...r,id:(null==r?void 0:r.id)||v()}))(t,e,r);return A(o.toasterId||(a=o.id,Object.keys(P).find(e=>P[e].toasts.some(e=>e.id===a))))({type:2,toast:o}),o.id},N=(e,t)=>j("blank")(e,t);N.error=j("error"),N.success=j("success"),N.loading=j("loading"),N.custom=j("custom"),N.dismiss=(e,t)=>{let r={type:3,toastId:e};t?A(t)(r):D(r)},N.dismissAll=e=>N.dismiss(void 0,e),N.remove=(e,t)=>{let r={type:4,toastId:e};t?A(t)(r):D(r)},N.removeAll=e=>N.remove(void 0,e),N.promise=(e,t,r)=>{let a=N.loading(t.loading,{...r,...null==r?void 0:r.loading});return"function"==typeof e&&(e=e()),e.then(e=>{let o=t.success?b(t.success,e):void 0;return o?N.success(o,{id:a,...r,...null==r?void 0:r.success}):N.dismiss(a),e}).catch(e=>{let o=t.error?b(t.error,e):void 0;o?N.error(o,{id:a,...r,...null==r?void 0:r.error}):N.dismiss(a)}),e};var $=1e3,I=(e,t="default")=>{let{toasts:r,pausedAt:a}=T(e,t),n=(0,o.useRef)(new Map).current,i=(0,o.useCallback)((e,t=$)=>{if(n.has(e))return;let r=setTimeout(()=>{n.delete(e),s({type:4,toastId:e})},t);n.set(e,r)},[]);(0,o.useEffect)(()=>{if(a)return;let e=Date.now(),o=r.map(r=>{if(r.duration===1/0)return;let a=(r.duration||0)+r.pauseDuration-(e-r.createdAt);if(a<0){r.visible&&N.dismiss(r.id);return}return setTimeout(()=>N.dismiss(r.id,t),a)});return()=>{o.forEach(e=>e&&clearTimeout(e))}},[r,a,t]);let s=(0,o.useCallback)(A(t),[t]),l=(0,o.useCallback)(()=>{s({type:5,time:Date.now()})},[s]),c=(0,o.useCallback)((e,t)=>{s({type:1,toast:{id:e,height:t}})},[s]),u=(0,o.useCallback)(()=>{a&&s({type:6,time:Date.now()})},[a,s]),d=(0,o.useCallback)((e,t)=>{let{reverseOrder:a=!1,gutter:o=8,defaultPosition:n}=t||{},i=r.filter(t=>(t.position||n)===(e.position||n)&&t.height),s=i.findIndex(t=>t.id===e.id),l=i.filter((e,t)=>t<s&&e.visible).length;return i.filter(e=>e.visible).slice(...a?[l+1]:[0,l]).reduce((e,t)=>e+(t.height||0)+o,0)},[r]);return(0,o.useEffect)(()=>{r.forEach(e=>{if(e.dismissed)i(e.id,e.removeDelay);else{let t=n.get(e.id);t&&(clearTimeout(t),n.delete(e.id))}})},[r,i]),{toasts:r,handlers:{updateHeight:c,startPause:l,endPause:u,calculateOffset:d}}},_=h`
from {
  transform: scale(0) rotate(45deg);
	opacity: 0;
}
to {
 transform: scale(1) rotate(45deg);
  opacity: 1;
}`,z=h`
from {
  transform: scale(0);
  opacity: 0;
}
to {
  transform: scale(1);
  opacity: 1;
}`,L=h`
from {
  transform: scale(0) rotate(90deg);
	opacity: 0;
}
to {
  transform: scale(1) rotate(90deg);
	opacity: 1;
}`,R=y("div")`
  width: 20px;
  opacity: 0;
  height: 20px;
  border-radius: 10px;
  background: ${e=>e.primary||"#ff4b4b"};
  position: relative;
  transform: rotate(45deg);

  animation: ${_} 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)
    forwards;
  animation-delay: 100ms;

  &:after,
  &:before {
    content: '';
    animation: ${z} 0.15s ease-out forwards;
    animation-delay: 150ms;
    position: absolute;
    border-radius: 3px;
    opacity: 0;
    background: ${e=>e.secondary||"#fff"};
    bottom: 9px;
    left: 4px;
    height: 2px;
    width: 12px;
  }

  &:before {
    animation: ${L} 0.15s ease-out forwards;
    animation-delay: 180ms;
    transform: rotate(90deg);
  }
`,M=h`
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
`,F=y("div")`
  width: 12px;
  height: 12px;
  box-sizing: border-box;
  border: 2px solid;
  border-radius: 100%;
  border-color: ${e=>e.secondary||"#e0e0e0"};
  border-right-color: ${e=>e.primary||"#616161"};
  animation: ${M} 1s linear infinite;
`,B=h`
from {
  transform: scale(0) rotate(45deg);
	opacity: 0;
}
to {
  transform: scale(1) rotate(45deg);
	opacity: 1;
}`,U=h`
0% {
	height: 0;
	width: 0;
	opacity: 0;
}
40% {
  height: 0;
	width: 6px;
	opacity: 1;
}
100% {
  opacity: 1;
  height: 10px;
}`,H=y("div")`
  width: 20px;
  opacity: 0;
  height: 20px;
  border-radius: 10px;
  background: ${e=>e.primary||"#61d345"};
  position: relative;
  transform: rotate(45deg);

  animation: ${B} 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)
    forwards;
  animation-delay: 100ms;
  &:after {
    content: '';
    box-sizing: border-box;
    animation: ${U} 0.2s ease-out forwards;
    opacity: 0;
    animation-delay: 200ms;
    position: absolute;
    border-right: 2px solid;
    border-bottom: 2px solid;
    border-color: ${e=>e.secondary||"#fff"};
    bottom: 6px;
    left: 6px;
    height: 10px;
    width: 6px;
  }
`,q=y("div")`
  position: absolute;
`,Z=y("div")`
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  min-width: 20px;
  min-height: 20px;
`,K=h`
from {
  transform: scale(0.6);
  opacity: 0.4;
}
to {
  transform: scale(1);
  opacity: 1;
}`,Q=y("div")`
  position: relative;
  transform: scale(0.6);
  opacity: 0.4;
  min-width: 20px;
  animation: ${K} 0.3s 0.12s cubic-bezier(0.175, 0.885, 0.32, 1.275)
    forwards;
`,V=({toast:e})=>{let{icon:t,type:r,iconTheme:a}=e;return void 0!==t?"string"==typeof t?o.createElement(Q,null,t):t:"blank"===r?null:o.createElement(Z,null,o.createElement(F,{...a}),"loading"!==r&&o.createElement(q,null,"error"===r?o.createElement(R,{...a}):o.createElement(H,{...a})))},G=y("div")`
  display: flex;
  align-items: center;
  background: #fff;
  color: #363636;
  line-height: 1.3;
  will-change: transform;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.1), 0 3px 3px rgba(0, 0, 0, 0.05);
  max-width: 350px;
  pointer-events: auto;
  padding: 8px 10px;
  border-radius: 8px;
`,J=y("div")`
  display: flex;
  justify-content: center;
  margin: 4px 10px;
  color: inherit;
  flex: 1 1 auto;
  white-space: pre-line;
`,W=o.memo(({toast:e,position:t,style:r,children:a})=>{let n=e.height?((e,t)=>{let r=e.includes("top")?1:-1,[a,o]=x()?["0%{opacity:0;} 100%{opacity:1;}","0%{opacity:1;} 100%{opacity:0;}"]:[`
0% {transform: translate3d(0,${-200*r}%,0) scale(.6); opacity:.5;}
100% {transform: translate3d(0,0,0) scale(1); opacity:1;}
`,`
0% {transform: translate3d(0,0,-1px) scale(1); opacity:1;}
100% {transform: translate3d(0,${-150*r}%,-1px) scale(.6); opacity:0;}
`];return{animation:t?`${h(a)} 0.35s cubic-bezier(.21,1.02,.73,1) forwards`:`${h(o)} 0.4s forwards cubic-bezier(.06,.71,.55,1)`}})(e.position||t||"top-center",e.visible):{opacity:0},i=o.createElement(V,{toast:e}),s=o.createElement(J,{...e.ariaProps},b(e.message,e));return o.createElement(G,{className:e.className,style:{...n,...r,...e.style}},"function"==typeof a?a({icon:i,message:s}):o.createElement(o.Fragment,null,i,s))});a=o.createElement,c.p=void 0,p=a,m=void 0,g=void 0;var X=({id:e,className:t,style:r,onHeightUpdate:a,children:n})=>{let i=o.useCallback(t=>{if(t){let r=()=>{a(e,t.getBoundingClientRect().height)};r(),new MutationObserver(r).observe(t,{subtree:!0,childList:!0,characterData:!0})}},[e,a]);return o.createElement("div",{ref:i,className:t,style:r},n)},Y=f`
  z-index: 9999;
  > * {
    pointer-events: auto;
  }
`;e.s(["CheckmarkIcon",0,H,"ErrorIcon",0,R,"LoaderIcon",0,F,"ToastBar",0,W,"ToastIcon",0,V,"Toaster",0,({reverseOrder:e,position:t="top-center",toastOptions:r,gutter:a,children:n,toasterId:i,containerStyle:s,containerClassName:l})=>{let{toasts:c,handlers:u}=I(r,i);return o.createElement("div",{"data-rht-toaster":i||"",style:{position:"fixed",zIndex:9999,top:16,left:16,right:16,bottom:16,pointerEvents:"none",...s},className:l,onMouseEnter:u.startPause,onMouseLeave:u.endPause},c.map(r=>{let i,s,l=r.position||t,c=u.calculateOffset(r,{reverseOrder:e,gutter:a,defaultPosition:t}),d=(i=l.includes("top"),s=l.includes("center")?{justifyContent:"center"}:l.includes("right")?{justifyContent:"flex-end"}:{},{left:0,right:0,display:"flex",position:"absolute",transition:x()?void 0:"all 230ms cubic-bezier(.21,1.02,.73,1)",transform:`translateY(${c*(i?1:-1)}px)`,...i?{top:0}:{bottom:0},...s});return o.createElement(X,{id:r.id,key:r.id,onHeightUpdate:u.updateHeight,className:r.visible?Y:"",style:d},"custom"===r.type?b(r.message,r):n?n(r):o.createElement(W,{toast:r,position:l}))}))},"default",0,N,"resolveValue",0,b,"toast",0,N,"useToaster",0,I,"useToasterStore",0,T],89195)},3996,e=>{"use strict";var t=e.i(42613);e.s(["doc",()=>t.a6])},93215,e=>{"use strict";e.i(10635);var t=e.i(33674),t=t,r=t,a=t,o=e.i(36939);async function n(e,r){return(0,t.ac)(o.auth,e,r)}async function i(){return(0,r.D)(o.auth)}e.s(["onAuthChange",0,function(e){return(0,a.z)(o.auth,e)},"signIn",0,n,"signOut",0,i],93215)},25790,e=>{"use strict";var t=e.i(93932),r=e.i(94611);e.i(25811);var a=e.i(3996),o=e.i(38895),n=e.i(36939),i=e.i(93215);let s="dekoor",l=[{id:"dekoor",name:"Tradicional Dekoor",description:"Azul y naranja de la marca. Limpio y profesional.",isDark:!1,swatches:{bg:"#f7f9fa",surface:"#ffffff",primary:"#1b4d5c",accent:"#d4722c",text:"#16252a"}},{id:"obsidian",name:"Obsidiana",description:"Modo oscuro elegante, fondo negro con acentos vivos.",isDark:!0,swatches:{bg:"#0c0d10",surface:"#1b1e24",primary:"#6e8bff",accent:"#f0985a",text:"#f2f3f5"}},{id:"lila",name:"Lila",description:"Lavanda suave y delicado, con toques rosa.",isDark:!1,swatches:{bg:"#faf7fe",surface:"#ffffff",primary:"#8a5cd1",accent:"#d6608f",text:"#2b2238"}},{id:"elegante",name:"Elegante",description:"Marfil cálido con verde salvia y dorado. Sobrio.",isDark:!1,swatches:{bg:"#faf8f4",surface:"#ffffff",primary:"#47634f",accent:"#b08d57",text:"#2a2722"}},{id:"minimal",name:"Minimalista",description:"Blanco y negro moderno, con un único acento azul.",isDark:!1,swatches:{bg:"#ffffff",surface:"#ffffff",primary:"#18181b",accent:"#2563eb",text:"#18181b"}}],c=new Set(l.map(e=>e.id));function u(e){return l.find(t=>t.id===e)??l[0]}function d(e){return"string"==typeof e&&c.has(e)?e:"dark"===e?"obsidian":"light"===e?"dekoor":s}let f="dekoor-theme";function p(e){if("u"<typeof document)return;let t=u(e),r=document.documentElement;r.dataset.theme=e,r.classList.toggle("dark",t.isDark);let a=document.querySelector('meta[name="theme-color"]');a||((a=document.createElement("meta")).name="theme-color",document.head.appendChild(a)),a.content=t.isDark?t.swatches.bg:t.swatches.primary}let m=(0,r.createContext)(null);e.s(["ThemeProvider",0,function({children:e}){let[c,g]=(0,r.useState)(s),h=(0,r.useRef)(null),y=(0,r.useRef)(!1),b=(0,r.useRef)(null);(0,r.useEffect)(()=>{let e=null;try{e=localStorage.getItem(f)}catch{}let t=d(e);g(t),p(t)},[]),(0,r.useEffect)(()=>(0,i.onAuthChange)(async e=>{if(b.current=e?.uid??null,!e){h.current=null;return}if(h.current!==e.uid){h.current=e.uid;try{let t=await (0,o.getDoc)((0,a.doc)(n.db,"users",e.uid)),r=t.exists()?t.data().theme:void 0;if(!r||y.current)return;let i=d(r);g(i),p(i);try{localStorage.setItem(f,i)}catch{}}catch{}}}),[]);let v=(0,r.useCallback)(e=>{y.current=!0,g(e),p(e);try{localStorage.setItem(f,e)}catch{}let t=b.current;t&&(0,o.setDoc)((0,a.doc)(n.db,"users",t),{theme:e},{merge:!0}).catch(()=>{})},[]),x={theme:c,meta:u(c),setTheme:v,themes:l,isDark:u(c).isDark};return(0,t.jsx)(m.Provider,{value:x,children:e})},"useTheme",0,function(){let e=(0,r.useContext)(m);if(!e)throw Error("useTheme debe usarse dentro de <ThemeProvider>");return e}],25790)},98743,e=>{"use strict";var t=e.i(94611),r=e.i(93215);let a=(0,t.createContext)({user:null,loading:!0});e.s(["AuthContext",0,a,"useAuth",0,function(){return(0,t.useContext)(a)},"useAuthState",0,function(){let[e,a]=(0,t.useState)({user:null,loading:!0});return(0,t.useEffect)(()=>(0,r.onAuthChange)(e=>{a({user:e,loading:!1})}),[]),e}])},10132,e=>{"use strict";var t=e.i(93932),r=e.i(98743);e.s(["default",0,function({children:e}){let a=(0,r.useAuthState)();return(0,t.jsx)(r.AuthContext.Provider,{value:a,children:e})}])}]);