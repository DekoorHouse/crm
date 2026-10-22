(()=>{"use strict";(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,3996,e=>{var t=e.i(42613);e.s(["f",()=>t.a6])},20757,(e,t,r)=>{e.i(3585),Object.defineProperty(r,"__esModule",{value:!0}),Object.defineProperty(r,"useRouterBFCache",{enumerable:!0,get:function(){return n}});let a=e.r(94611);function n(e,t,r){let[n,o]=(0,a.useState)(()=>({tree:e,renderTree:t,stateKey:r,next:null}));if(n.tree===e)return n;let l={tree:e,renderTree:t,stateKey:r,next:null},i=1,s=n,u=l;for(;null!==s&&i<1;){if(s.stateKey===r){u.next=s.next;break}{i++;let e={tree:s.tree,renderTree:s.renderTree,stateKey:s.stateKey,next:null};u.next=e,u=e}s=s.next}return o(l),l}("function"==typeof r.default||"object"==typeof r.default&&null!==r.default)&&void 0===r.default.__esModule&&(Object.defineProperty(r.default,"__esModule",{value:!0}),Object.assign(r.default,r),t.exports=r.default)},45540,(e,t,r)=>{Object.defineProperty(r,"__esModule",{value:!0});var a={createClientParams:function(){return o.createRenderParamsFromClient},createClientSearchParams:function(){return l.createRenderSearchParamsFromClient}};for(var n in a)Object.defineProperty(r,n,{enumerable:!0,get:a[n]});let o=e.r(55296),l=e.r(33736);("function"==typeof r.default||"object"==typeof r.default&&null!==r.default)&&void 0===r.default.__esModule&&(Object.defineProperty(r.default,"__esModule",{value:!0}),Object.assign(r.default,r),t.exports=r.default)},65033,(e,t,r)=>{Object.defineProperty(r,"__esModule",{value:!0}),Object.defineProperty(r,"ClientPageRoot",{enumerable:!0,get:function(){return u}});let a=e.r(93932),n=e.r(70142),o=e.r(94611),l=e.r(92420),i=e.r(47243),s=e.r(45540);function u({Component:e,serverProvidedParams:t}){let r,d;if(null!==t)r=t.searchParams,d=t.params;else{let e=(0,o.use)(n.LayoutRouterContext);d=null!==e?e.parentParams:{},r=(0,l.urlSearchParamsToParsedUrlQuery)((0,o.use)(i.SearchParamsContext))}let c=(0,s.createClientSearchParams)(r),f=(0,s.createClientParams)(d);return(0,a.jsx)(e,{params:f,searchParams:c})}("function"==typeof r.default||"object"==typeof r.default&&null!==r.default)&&void 0===r.default.__esModule&&(Object.defineProperty(r.default,"__esModule",{value:!0}),Object.assign(r.default,r),t.exports=r.default)},44715,(e,t,r)=>{Object.defineProperty(r,"__esModule",{value:!0}),Object.defineProperty(r,"ClientSegmentRoot",{enumerable:!0,get:function(){return i}});let a=e.r(93932),n=e.r(70142),o=e.r(94611),l=e.r(45540);function i({Component:e,slots:t,serverProvidedParams:r}){let s;if(null!==r)s=r.params;else{let e=(0,o.use)(n.LayoutRouterContext);s=null!==e?e.parentParams:{}}let u=(0,l.createClientParams)(s);return(0,a.jsx)(e,{...t,params:u})}("function"==typeof r.default||"object"==typeof r.default&&null!==r.default)&&void 0===r.default.__esModule&&(Object.defineProperty(r.default,"__esModule",{value:!0}),Object.assign(r.default,r),t.exports=r.default)},42719,(e,t,r)=>{e.i(3585),Object.defineProperty(r,"__esModule",{value:!0}),Object.defineProperty(r,"HTTPAccessFallbackBoundary",{enumerable:!0,get:function(){return d}});let a=e.r(25865),n=e.r(93932),o=a._(e.r(94611)),l=e.r(16462),i=e.r(63988),s=e.r(70142);class u extends o.default.Component{constructor(e){super(e),this.state={triggeredStatus:void 0,previousPathname:e.pathname}}componentDidCatch(){}static getDerivedStateFromError(e){if((0,i.isHTTPAccessFallbackError)(e))return{triggeredStatus:(0,i.getAccessFallbackHTTPStatus)(e)};throw e}static getDerivedStateFromProps(e,t){return e.pathname!==t.previousPathname&&t.triggeredStatus?{triggeredStatus:void 0,previousPathname:e.pathname}:{triggeredStatus:t.triggeredStatus,previousPathname:e.pathname}}render(){let{notFound:e,forbidden:t,unauthorized:r,children:a}=this.props,{triggeredStatus:o}=this.state,l={[i.HTTPAccessErrorStatus.NOT_FOUND]:e,[i.HTTPAccessErrorStatus.FORBIDDEN]:t,[i.HTTPAccessErrorStatus.UNAUTHORIZED]:r};if(o){let s=o===i.HTTPAccessErrorStatus.NOT_FOUND&&e,u=o===i.HTTPAccessErrorStatus.FORBIDDEN&&t,d=o===i.HTTPAccessErrorStatus.UNAUTHORIZED&&r;return s||u||d?(0,n.jsxs)(n.Fragment,{children:[(0,n.jsx)("meta",{name:"robots",content:"noindex"}),!1,l[o]]}):a}return a}}function d({notFound:e,forbidden:t,unauthorized:r,children:a}){let i=(0,l.useUntrackedPathname)(),c=(0,o.useContext)(s.MissingSlotContext);return e||t||r?(0,n.jsx)(u,{pathname:i,notFound:e,forbidden:t,unauthorized:r,missingSlots:c,children:a}):(0,n.jsx)(n.Fragment,{children:a})}("function"==typeof r.default||"object"==typeof r.default&&null!==r.default)&&void 0===r.default.__esModule&&(Object.defineProperty(r.default,"__esModule",{value:!0}),Object.assign(r.default,r),t.exports=r.default)},90284,(e,t,r)=>{Object.defineProperty(r,"__esModule",{value:!0});var a={InstantValidationBoundaryContext:function(){return o.InstantValidationBoundaryContext},PlaceValidationBoundaryBelowThisLevel:function(){return o.PlaceValidationBoundaryBelowThisLevel},RenderValidationBoundaryAtThisLevel:function(){return o.RenderValidationBoundaryAtThisLevel},SlotMarker:function(){return o.SlotMarker}};for(var n in a)Object.defineProperty(r,n,{enumerable:!0,get:a[n]});let o=e.r(86258);("function"==typeof r.default||"object"==typeof r.default&&null!==r.default)&&void 0===r.default.__esModule&&(Object.defineProperty(r.default,"__esModule",{value:!0}),Object.assign(r.default,r),t.exports=r.default)},86258,(e,t,r)=>{Object.defineProperty(r,"__esModule",{value:!0});var a={InstantValidationBoundaryContext:function(){return o},PlaceValidationBoundaryBelowThisLevel:function(){return l},RenderValidationBoundaryAtThisLevel:function(){return i},SlotMarker:function(){return s}};for(var n in a)Object.defineProperty(r,n,{enumerable:!0,get:a[n]});let o=null,l=null,i=null,s=null;("function"==typeof r.default||"object"==typeof r.default&&null!==r.default)&&void 0===r.default.__esModule&&(Object.defineProperty(r.default,"__esModule",{value:!0}),Object.assign(r.default,r),t.exports=r.default)},7226,(e,t,r)=>{e.i(3585),Object.defineProperty(r,"__esModule",{value:!0});var a={LoadingBoundaryProvider:function(){return _},default:function(){return w}};for(var n in a)Object.defineProperty(r,n,{enumerable:!0,get:a[n]});let o=e.r(25865),l=e.r(93932),i=o._(e.r(94611)),s=e.r(70142),u=e.r(46174),d=e.r(49085),c=e.r(59970),f=e.r(26632),p=e.r(42719);e.r(90284);let m=e.r(25070),y=e.r(20757);e.r(36785);let h=e.r(47243),b=e.r(92420),g=e.r(87089);function v(e,t,r){let a=e.getClientRects();if(0===a.length)return 0;let n=1/0;for(let e=0;e<a.length;e++){let t=a[e];t.top<n&&(n=t.top)}return n>=r()&&n<=t?1:2}function x(e){let t=i.default.useRef(null);return(0,i.useLayoutEffect)(()=>{let{scrollRef:r,renderTree:a}=e,n=r.forceScroll?r.scrollRef:a.data.scrollRef;if(null===n||!n.current)return;let o=null,l=r.hashFragment;if(l){if(null===(o="top"===l?document.body:document.getElementById(l)??document.getElementsByName(l)[0]??null)){n.current=!1,r.onlyHashChange=!1,r.hashFragment=null;return}}else o=t.current;if(null===o)return;let i=!1;(0,c.disableSmoothScrollDuringRouteTransition)(()=>{let e=document.documentElement,t=null,r=null,a=null,s=()=>{var r;let n,o;return null===a&&(r=t,a=!Number.isFinite(o=Number.parseFloat(n=getComputedStyle(e).scrollPaddingTop))||o<0?0:n.endsWith("px")?o:n.endsWith("%")?o/100*r:0),a};(l||(t=e.clientHeight,0!==(r=v(o,t,s))))&&((i=!0,n.current=!1,l)?o.scrollIntoView():1!==r&&(e.scrollTop=0,2===v(o,t,s)&&o.scrollIntoView()))},{dontForceLayout:!0,onlyHashChange:r.onlyHashChange}),i&&(r.onlyHashChange=!1,r.hashFragment=null)},void 0),(0,l.jsx)(i.Fragment,{ref:t,children:e.children})}function P({children:e,renderTree:t}){let r=(0,i.useContext)(s.GlobalLayoutRouterContext);if(!r)throw Error("invariant global layout router not mounted");return(0,l.jsx)(x,{scrollRef:r.scrollRef,renderTree:t,children:e})}function j({tree:e,segmentPath:t,debugNameContext:r,renderTree:a,params:n,url:o,isActive:d}){let c,f=(0,i.useContext)(s.GlobalLayoutRouterContext);if((0,i.useContext)(h.NavigationPromisesContext),!f)throw Error("invariant global layout router not mounted");let p=null!==a.data.prefetchRsc?a.data.prefetchRsc:a.data.rsc,m=(0,i.useDeferredValue)(a.data.rsc,p);if((0,g.isDeferredRsc)(m)){let e=(0,i.use)(m);null===e&&(0,i.use)(u.unresolvedThenable),c=e}else null===m&&(0,i.use)(u.unresolvedThenable),c=m;let y=c;return(0,l.jsx)(s.LayoutRouterContext.Provider,{value:{parentTree:e,parentRenderTree:a,parentSegmentPath:t,parentParams:n,parentLoadingData:null,debugNameContext:r,url:o,isActive:d},children:y})}function _({loading:e,children:t}){let r=(0,i.use)(s.LayoutRouterContext);return null===r?t:(0,l.jsx)(s.LayoutRouterContext.Provider,{value:{parentTree:r.parentTree,parentRenderTree:r.parentRenderTree,parentSegmentPath:r.parentSegmentPath,parentParams:r.parentParams,parentLoadingData:e,debugNameContext:r.debugNameContext,url:r.url,isActive:r.isActive},children:t})}function O({name:e,loading:t,children:r}){if(null!==t){let a=t[0],n=t[1],o=t[2];return(0,l.jsx)(i.Suspense,{name:e,fallback:(0,l.jsxs)(l.Fragment,{children:[n,o,a]}),children:r})}return(0,l.jsx)(l.Fragment,{children:r})}function w({parallelRouterKey:e,error:t,errorStyles:r,errorScripts:a,templateStyles:n,templateScripts:o,template:c,notFound:h,forbidden:g,unauthorized:v,segmentViewBoundaries:x}){let _=(0,i.useContext)(s.LayoutRouterContext);if(!_)throw Error("invariant expected layout router to be mounted");let{parentTree:C,parentRenderTree:T,parentSegmentPath:S,parentParams:M,parentLoadingData:R,url:k,isActive:E,debugNameContext:D}=_,F=C[0],A=null===S?[e]:S.concat([F,e]),L=C[1][e],B=T.slots?.get(e);(void 0===L||void 0===B)&&(0,i.use)(u.unresolvedThenable);let N=L[0],I=(0,m.createSegmentKey)(N),H=(0,y.useRouterBFCache)(L,B,I),$=[];do{let e=H.tree,i=H.renderTree,u=H.stateKey,m=e[0],y=M;if(Array.isArray(m)){let e=m[0],t=m[1],r=m[2],a=(0,b.getParamValueFromCacheKey)(t,r);null!==a&&(y={...M,[e]:a})}let x=function(e){if("/"===e)return"/";if("string"==typeof e)if("(__SLOT__)"===e)return;else return e+"/";return e[1]+"/"}(m),_=x??D,w=void 0===x?void 0:D,C=(0,l.jsxs)(P,{renderTree:i,children:[(0,l.jsx)(d.ErrorBoundary,{errorComponent:t,errorStyles:r,errorScripts:a,children:(0,l.jsx)(O,{name:w,loading:R,children:(0,l.jsx)(p.HTTPAccessFallbackBoundary,{notFound:h,forbidden:g,unauthorized:v,children:(0,l.jsxs)(f.RedirectBoundary,{children:[(0,l.jsx)(j,{url:k,tree:e,params:y,renderTree:i,segmentPath:A,debugNameContext:_,isActive:E&&u===I}),null]})})})}),null]}),T=(0,l.jsxs)(s.TemplateContext.Provider,{value:C,children:[n,o,c]},u);$.push(T),H=H.next}while(null!==H)return $}("function"==typeof r.default||"object"==typeof r.default&&null!==r.default)&&void 0===r.default.__esModule&&(Object.defineProperty(r.default,"__esModule",{value:!0}),Object.assign(r.default,r),t.exports=r.default)},74176,(e,t,r)=>{Object.defineProperty(r,"__esModule",{value:!0}),Object.defineProperty(r,"default",{enumerable:!0,get:function(){return i}});let a=e.r(25865),n=e.r(93932),o=a._(e.r(94611)),l=e.r(70142);function i(){let e=(0,o.useContext)(l.TemplateContext);return(0,n.jsx)(n.Fragment,{children:e})}("function"==typeof r.default||"object"==typeof r.default&&null!==r.default)&&void 0===r.default.__esModule&&(Object.defineProperty(r.default,"__esModule",{value:!0}),Object.assign(r.default,r),t.exports=r.default)},55296,(e,t,r)=>{e.i(3585),Object.defineProperty(r,"__esModule",{value:!0}),Object.defineProperty(r,"createRenderParamsFromClient",{enumerable:!0,get:function(){return a}});let a=e.r(63727).createRenderParamsFromClient;("function"==typeof r.default||"object"==typeof r.default&&null!==r.default)&&void 0===r.default.__esModule&&(Object.defineProperty(r.default,"__esModule",{value:!0}),Object.assign(r.default,r),t.exports=r.default)},63727,(e,t,r)=>{Object.defineProperty(r,"__esModule",{value:!0}),Object.defineProperty(r,"createRenderParamsFromClient",{enumerable:!0,get:function(){return n}});let a=new WeakMap;function n(e){let t=a.get(e);if(t)return t;let r=Promise.resolve(e);return r.status="fulfilled",r.value=e,a.set(e,r),r}("function"==typeof r.default||"object"==typeof r.default&&null!==r.default)&&void 0===r.default.__esModule&&(Object.defineProperty(r.default,"__esModule",{value:!0}),Object.assign(r.default,r),t.exports=r.default)},33736,(e,t,r)=>{e.i(3585),Object.defineProperty(r,"__esModule",{value:!0}),Object.defineProperty(r,"createRenderSearchParamsFromClient",{enumerable:!0,get:function(){return a}});let a=e.r(44501).createRenderSearchParamsFromClient;("function"==typeof r.default||"object"==typeof r.default&&null!==r.default)&&void 0===r.default.__esModule&&(Object.defineProperty(r.default,"__esModule",{value:!0}),Object.assign(r.default,r),t.exports=r.default)},44501,(e,t,r)=>{Object.defineProperty(r,"__esModule",{value:!0}),Object.defineProperty(r,"createRenderSearchParamsFromClient",{enumerable:!0,get:function(){return n}});let a=new WeakMap;function n(e){let t=a.get(e);if(t)return t;let r=Promise.resolve(e);return r.status="fulfilled",r.value=e,a.set(e,r),r}("function"==typeof r.default||"object"==typeof r.default&&null!==r.default)&&void 0===r.default.__esModule&&(Object.defineProperty(r.default,"__esModule",{value:!0}),Object.assign(r.default,r),t.exports=r.default)},91498,(e,t,r)=>{Object.defineProperty(r,"__esModule",{value:!0}),Object.defineProperty(r,"IconMark",{enumerable:!0,get:function(){return n}});let a=e.r(93932),n=()=>"u">typeof window?null:(0,a.jsx)("meta",{name:"«nxt-icon»"})},59970,(e,t,r)=>{function a(e,t={}){if(t.onlyHashChange)return void e();let r=document.documentElement;if("smooth"!==r.dataset.scrollBehavior)return void e();let n=r.style.scrollBehavior;r.style.scrollBehavior="auto",t.dontForceLayout||r.getClientRects(),e(),r.style.scrollBehavior=n}e.i(3585),Object.defineProperty(r,"__esModule",{value:!0}),Object.defineProperty(r,"disableSmoothScrollDuringRouteTransition",{enumerable:!0,get:function(){return a}})},89195,e=>{let t,r;var a,n=e.i(94611);let o={data:""},l=/(?:([\u0080-\uFFFF\w-%@]+) *:? *([^{;]+?);|([^;}{]*?) *{)|(}\s*)/g,i=/\/\*[^]*?\*\/|  +/g,s=/\n+/g,u=(e,t)=>{let r="",a="",n="";for(let o in e){let l=e[o];"@"==o[0]?"i"==o[1]?r=o+" "+l+";":a+="f"==o[1]?u(l,o):o+"{"+u(l,"k"==o[1]?"":t)+"}":"object"==typeof l?a+=u(l,t?t.replace(/([^,])+/g,e=>o.replace(/([^,]*:\S+\([^)]*\))|([^,])+/g,t=>/&/.test(t)?t.replace(/&/g,e):e?e+" "+t:t)):o):null!=l&&(o=/^--/.test(o)?o:o.replace(/[A-Z]/g,"-$&").toLowerCase(),n+=u.p?u.p(o,l):o+":"+l+";")}return r+(t&&n?t+"{"+n+"}":n)+a},d={},c=e=>{if("object"==typeof e){let t="";for(let r in e)t+=r+c(e[r]);return t}return e};function f(e){let t,r,a=this||{},n=e.call?e(a.p):e;return((e,t,r,a,n)=>{var o;let f=c(e),p=d[f]||(d[f]=(e=>{let t=0,r=11;for(;t<e.length;)r=101*r+e.charCodeAt(t++)>>>0;return"go"+r})(f));if(!d[p]){let t=f!==e?e:(e=>{let t,r,a=[{}];for(;t=l.exec(e.replace(i,""));)t[4]?a.shift():t[3]?(r=t[3].replace(s," ").trim(),a.unshift(a[0][r]=a[0][r]||{})):a[0][t[1]]=t[2].replace(s," ").trim();return a[0]})(e);d[p]=u(n?{["@keyframes "+p]:t}:t,r?"":"."+p)}let m=r&&d.g?d.g:null;return r&&(d.g=d[p]),o=d[p],m?t.data=t.data.replace(m,o):-1===t.data.indexOf(o)&&(t.data=a?o+t.data:t.data+o),p})(n.unshift?n.raw?(t=[].slice.call(arguments,1),r=a.p,n.reduce((e,a,n)=>{let o=t[n];if(o&&o.call){let e=o(r),t=e&&e.props&&e.props.className||/^go/.test(e)&&e;o=t?"."+t:e&&"object"==typeof e?e.props?"":u(e,""):!1===e?"":e}return e+a+(null==o?"":o)},"")):n.reduce((e,t)=>Object.assign(e,t&&t.call?t(a.p):t),{}):n,(e=>{if("object"==typeof window){let t=(e?e.querySelector("#_goober"):window._goober)||Object.assign(document.createElement("style"),{innerHTML:" ",id:"_goober"});return t.nonce=window.__nonce__,t.parentNode||(e||document.head).appendChild(t),t.firstChild}return e||o})(a.target),a.g,a.o,a.k)}let p,m,y,h=(f.bind({g:1}),f.bind({k:1}));function b(e,t){let r=this||{};return function(){let a=arguments;function n(o,l){let i=Object.assign({},o),s=i.className||n.className;r.p=Object.assign({theme:m&&m()},i),r.o=/ *go\d+/.test(s),i.className=f.apply(r,a)+(s?" "+s:""),t&&(i.ref=l);let u=e;return e[0]&&(u=i.as||e,delete i.as),y&&u[0]&&y(i),p(u,i)}return t?t(n):n}}var g=(e,t)=>"function"==typeof e?e(t):e,v=(t=0,()=>(++t).toString()),x=()=>{if(void 0===r&&"u">typeof window){let e=matchMedia("(prefers-reduced-motion: reduce)");r=!e||e.matches}return r},P="default",j=(e,t)=>{let{toastLimit:r}=e.settings;switch(t.type){case 0:return{...e,toasts:[t.toast,...e.toasts].slice(0,r)};case 1:return{...e,toasts:e.toasts.map(e=>e.id===t.toast.id?{...e,...t.toast}:e)};case 2:let{toast:a}=t;return j(e,{type:+!!e.toasts.find(e=>e.id===a.id),toast:a});case 3:let{toastId:n}=t;return{...e,toasts:e.toasts.map(e=>e.id===n||void 0===n?{...e,dismissed:!0,visible:!1}:e)};case 4:return void 0===t.toastId?{...e,toasts:[]}:{...e,toasts:e.toasts.filter(e=>e.id!==t.toastId)};case 5:return{...e,pausedAt:t.time};case 6:let o=t.time-(e.pausedAt||0);return{...e,pausedAt:void 0,toasts:e.toasts.map(e=>({...e,pauseDuration:e.pauseDuration+o}))}}},_=[],O={toasts:[],pausedAt:void 0,settings:{toastLimit:20}},w={},C=(e,t=P)=>{w[t]=j(w[t]||O,e),_.forEach(([e,r])=>{e===t&&r(w[t])})},T=e=>Object.keys(w).forEach(t=>C(e,t)),S=(e=P)=>t=>{C(t,e)},M={blank:4e3,error:4e3,success:2e3,loading:1/0,custom:4e3},R=e=>(t,r)=>{let a,n=((e,t="blank",r)=>({createdAt:Date.now(),visible:!0,dismissed:!1,type:t,ariaProps:{role:"status","aria-live":"polite"},message:e,pauseDuration:0,...r,id:(null==r?void 0:r.id)||v()}))(t,e,r);return S(n.toasterId||(a=n.id,Object.keys(w).find(e=>w[e].toasts.some(e=>e.id===a))))({type:2,toast:n}),n.id},k=(e,t)=>R("blank")(e,t);k.error=R("error"),k.success=R("success"),k.loading=R("loading"),k.custom=R("custom"),k.dismiss=(e,t)=>{let r={type:3,toastId:e};t?S(t)(r):T(r)},k.dismissAll=e=>k.dismiss(void 0,e),k.remove=(e,t)=>{let r={type:4,toastId:e};t?S(t)(r):T(r)},k.removeAll=e=>k.remove(void 0,e),k.promise=(e,t,r)=>{let a=k.loading(t.loading,{...r,...null==r?void 0:r.loading});return"function"==typeof e&&(e=e()),e.then(e=>{let n=t.success?g(t.success,e):void 0;return n?k.success(n,{id:a,...r,...null==r?void 0:r.success}):k.dismiss(a),e}).catch(e=>{let n=t.error?g(t.error,e):void 0;n?k.error(n,{id:a,...r,...null==r?void 0:r.error}):k.dismiss(a)}),e};var E=1e3,D=h`
from {
  transform: scale(0) rotate(45deg);
	opacity: 0;
}
to {
 transform: scale(1) rotate(45deg);
  opacity: 1;
}`,F=h`
from {
  transform: scale(0);
  opacity: 0;
}
to {
  transform: scale(1);
  opacity: 1;
}`,A=h`
from {
  transform: scale(0) rotate(90deg);
	opacity: 0;
}
to {
  transform: scale(1) rotate(90deg);
	opacity: 1;
}`,L=b("div")`
  width: 20px;
  opacity: 0;
  height: 20px;
  border-radius: 10px;
  background: ${e=>e.primary||"#ff4b4b"};
  position: relative;
  transform: rotate(45deg);

  animation: ${D} 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)
    forwards;
  animation-delay: 100ms;

  &:after,
  &:before {
    content: '';
    animation: ${F} 0.15s ease-out forwards;
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
    animation: ${A} 0.15s ease-out forwards;
    animation-delay: 180ms;
    transform: rotate(90deg);
  }
`,B=h`
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
`,N=b("div")`
  width: 12px;
  height: 12px;
  box-sizing: border-box;
  border: 2px solid;
  border-radius: 100%;
  border-color: ${e=>e.secondary||"#e0e0e0"};
  border-right-color: ${e=>e.primary||"#616161"};
  animation: ${B} 1s linear infinite;
`,I=h`
from {
  transform: scale(0) rotate(45deg);
	opacity: 0;
}
to {
  transform: scale(1) rotate(45deg);
	opacity: 1;
}`,H=h`
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
}`,$=b("div")`
  width: 20px;
  opacity: 0;
  height: 20px;
  border-radius: 10px;
  background: ${e=>e.primary||"#61d345"};
  position: relative;
  transform: rotate(45deg);

  animation: ${I} 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)
    forwards;
  animation-delay: 100ms;
  &:after {
    content: '';
    box-sizing: border-box;
    animation: ${H} 0.2s ease-out forwards;
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
`,z=b("div")`
  position: absolute;
`,U=b("div")`
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  min-width: 20px;
  min-height: 20px;
`,V=h`
from {
  transform: scale(0.6);
  opacity: 0.4;
}
to {
  transform: scale(1);
  opacity: 1;
}`,K=b("div")`
  position: relative;
  transform: scale(0.6);
  opacity: 0.4;
  min-width: 20px;
  animation: ${V} 0.3s 0.12s cubic-bezier(0.175, 0.885, 0.32, 1.275)
    forwards;
`,W=({toast:e})=>{let{icon:t,type:r,iconTheme:a}=e;return void 0!==t?"string"==typeof t?n.createElement(K,null,t):t:"blank"===r?null:n.createElement(U,null,n.createElement(N,{...a}),"loading"!==r&&n.createElement(z,null,"error"===r?n.createElement(L,{...a}):n.createElement($,{...a})))},q=b("div")`
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
`,G=b("div")`
  display: flex;
  justify-content: center;
  margin: 4px 10px;
  color: inherit;
  flex: 1 1 auto;
  white-space: pre-line;
`,Y=n.memo(({toast:e,position:t,style:r,children:a})=>{let o=e.height?((e,t)=>{let r=e.includes("top")?1:-1,[a,n]=x()?["0%{opacity:0;} 100%{opacity:1;}","0%{opacity:1;} 100%{opacity:0;}"]:[`
0% {transform: translate3d(0,${-200*r}%,0) scale(.6); opacity:.5;}
100% {transform: translate3d(0,0,0) scale(1); opacity:1;}
`,`
0% {transform: translate3d(0,0,-1px) scale(1); opacity:1;}
100% {transform: translate3d(0,${-150*r}%,-1px) scale(.6); opacity:0;}
`];return{animation:t?`${h(a)} 0.35s cubic-bezier(.21,1.02,.73,1) forwards`:`${h(n)} 0.4s forwards cubic-bezier(.06,.71,.55,1)`}})(e.position||t||"top-center",e.visible):{opacity:0},l=n.createElement(W,{toast:e}),i=n.createElement(G,{...e.ariaProps},g(e.message,e));return n.createElement(q,{className:e.className,style:{...o,...r,...e.style}},"function"==typeof a?a({icon:l,message:i}):n.createElement(n.Fragment,null,l,i))});a=n.createElement,u.p=void 0,p=a,m=void 0,y=void 0;var Z=({id:e,className:t,style:r,onHeightUpdate:a,children:o})=>{let l=n.useCallback(t=>{if(t){let r=()=>{a(e,t.getBoundingClientRect().height)};r(),new MutationObserver(r).observe(t,{subtree:!0,childList:!0,characterData:!0})}},[e,a]);return n.createElement("div",{ref:l,className:t,style:r},o)},Q=f`
  z-index: 9999;
  > * {
    pointer-events: auto;
  }
`;e.s(["Toaster",0,({reverseOrder:e,position:t="top-center",toastOptions:r,gutter:a,children:o,toasterId:l,containerStyle:i,containerClassName:s})=>{let{toasts:u,handlers:d}=((e,t="default")=>{let{toasts:r,pausedAt:a}=((e={},t=P)=>{let[r,a]=(0,n.useState)(w[t]||O),o=(0,n.useRef)(w[t]);(0,n.useEffect)(()=>(o.current!==w[t]&&a(w[t]),_.push([t,a]),()=>{let e=_.findIndex(([e])=>e===t);e>-1&&_.splice(e,1)}),[t]);let l=r.toasts.map(t=>{var r,a,n;return{...e,...e[t.type],...t,removeDelay:t.removeDelay||(null==(r=e[t.type])?void 0:r.removeDelay)||(null==e?void 0:e.removeDelay),duration:t.duration||(null==(a=e[t.type])?void 0:a.duration)||(null==e?void 0:e.duration)||M[t.type],style:{...e.style,...null==(n=e[t.type])?void 0:n.style,...t.style}}});return{...r,toasts:l}})(e,t),o=(0,n.useRef)(new Map).current,l=(0,n.useCallback)((e,t=E)=>{if(o.has(e))return;let r=setTimeout(()=>{o.delete(e),i({type:4,toastId:e})},t);o.set(e,r)},[]);(0,n.useEffect)(()=>{if(a)return;let e=Date.now(),n=r.map(r=>{if(1/0===r.duration)return;let a=(r.duration||0)+r.pauseDuration-(e-r.createdAt);if(a<0){r.visible&&k.dismiss(r.id);return}return setTimeout(()=>k.dismiss(r.id,t),a)});return()=>{n.forEach(e=>e&&clearTimeout(e))}},[r,a,t]);let i=(0,n.useCallback)(S(t),[t]),s=(0,n.useCallback)(()=>{i({type:5,time:Date.now()})},[i]),u=(0,n.useCallback)((e,t)=>{i({type:1,toast:{id:e,height:t}})},[i]),d=(0,n.useCallback)(()=>{a&&i({type:6,time:Date.now()})},[a,i]),c=(0,n.useCallback)((e,t)=>{let{reverseOrder:a=!1,gutter:n=8,defaultPosition:o}=t||{},l=r.filter(t=>(t.position||o)===(e.position||o)&&t.height),i=l.findIndex(t=>t.id===e.id),s=l.filter((e,t)=>t<i&&e.visible).length;return l.filter(e=>e.visible).slice(...a?[s+1]:[0,s]).reduce((e,t)=>e+(t.height||0)+n,0)},[r]);return(0,n.useEffect)(()=>{r.forEach(e=>{if(e.dismissed)l(e.id,e.removeDelay);else{let t=o.get(e.id);t&&(clearTimeout(t),o.delete(e.id))}})},[r,l]),{toasts:r,handlers:{updateHeight:u,startPause:s,endPause:d,calculateOffset:c}}})(r,l);return n.createElement("div",{"data-rht-toaster":l||"",style:{position:"fixed",zIndex:9999,top:16,left:16,right:16,bottom:16,pointerEvents:"none",...i},className:s,onMouseEnter:d.startPause,onMouseLeave:d.endPause},u.map(r=>{let l,i,s=r.position||t,u=d.calculateOffset(r,{reverseOrder:e,gutter:a,defaultPosition:t}),c=(l=s.includes("top"),i=s.includes("center")?{justifyContent:"center"}:s.includes("right")?{justifyContent:"flex-end"}:{},{left:0,right:0,display:"flex",position:"absolute",transition:x()?void 0:"all 230ms cubic-bezier(.21,1.02,.73,1)",transform:`translateY(${u*(l?1:-1)}px)`,...l?{top:0}:{bottom:0},...i});return n.createElement(Z,{id:r.id,key:r.id,onHeightUpdate:d.updateHeight,className:r.visible?Q:"",style:c},"custom"===r.type?g(r.message,r):o?o(r):n.createElement(Y,{toast:r,position:s}))}))},"default",0,k],89195)},10132,e=>{var t=e.i(93932),r=e.i(98743),a=e.i(36939);e.i(10635);var n=e.i(95762);let o=!1,l=null;!function(){if(o)return;o=!0;let e=window.fetch.bind(window);window.fetch=async(t,r)=>{if(!function(e){try{let t="string"==typeof e?e:e instanceof URL?e.href:e.url,r=new URL(t,window.location.origin);return r.origin===window.location.origin&&("/api"===r.pathname||r.pathname.startsWith("/api/"))}catch{return!1}}(t))return e(t,r);try{let o=new Headers(r?.headers??(t instanceof Request?t.headers:void 0));if(!o.has("Authorization")){await (!l&&(l=new Promise(e=>{let t=setTimeout(e,3e3),r=(0,n.f)(a.auth,()=>{clearTimeout(t),r(),e()},()=>{clearTimeout(t),r(),e()})})),l);let e=a.auth.currentUser;e&&o.set("Authorization",`Bearer ${await e.getIdToken()}`)}return e(t,{...r,headers:o})}catch{return e(t,r)}}}(),e.s(["default",0,function({children:e}){let a=(0,r.W)();return(0,t.jsx)(r.Y.Provider,{value:a,children:e})}],10132)},93215,95762,e=>{e.i(10635);var t=e.i(33674),t=t,r=t,a=t;e.s(["f",()=>a.z],95762);var a=t,n=e.i(36939);async function o(e,r){return(0,t.G)(n.auth,e,r)}async function l(){return(0,r.D)(n.auth)}e.s(["f",0,function(e){return(0,a.z)(n.auth,e)},"O",0,o,"_",0,l],93215)},98743,e=>{var t=e.i(94611),r=e.i(93215);let a=(0,t.createContext)({user:null,loading:!0});e.s(["Y",0,a,"F",0,function(){return(0,t.useContext)(a)},"W",0,function(){let[e,a]=(0,t.useState)({user:null,loading:!0});return(0,t.useEffect)(()=>(0,r.f)(e=>{a({user:e,loading:!1})}),[]),e}])},25790,e=>{var t=e.i(93932),r=e.i(94611);e.i(25811);var a=e.i(3996),n=e.i(38895),o=e.i(36939),l=e.i(93215);let i="dekoor",s=[{id:"dekoor",name:"Tradicional Dekoor",description:"Azul y naranja de la marca. Limpio y profesional.",isDark:!1,swatches:{bg:"#f7f9fa",surface:"#ffffff",primary:"#1b4d5c",accent:"#d4722c",text:"#16252a"}},{id:"obsidian",name:"Obsidiana",description:"Modo oscuro elegante, fondo negro con acentos vivos.",isDark:!0,swatches:{bg:"#0c0d10",surface:"#1b1e24",primary:"#6e8bff",accent:"#f0985a",text:"#f2f3f5"}},{id:"lila",name:"Lila",description:"Lavanda suave y delicado, con toques rosa.",isDark:!1,swatches:{bg:"#faf7fe",surface:"#ffffff",primary:"#8a5cd1",accent:"#d6608f",text:"#2b2238"}},{id:"elegante",name:"Elegante",description:"Marfil cálido con verde salvia y dorado. Sobrio.",isDark:!1,swatches:{bg:"#faf8f4",surface:"#ffffff",primary:"#47634f",accent:"#b08d57",text:"#2a2722"}},{id:"minimal",name:"Minimalista",description:"Blanco y negro moderno, con un único acento azul.",isDark:!1,swatches:{bg:"#ffffff",surface:"#ffffff",primary:"#18181b",accent:"#2563eb",text:"#18181b"}}],u=new Set(s.map(e=>e.id));function d(e){return s.find(t=>t.id===e)??s[0]}function c(e){return"string"==typeof e&&u.has(e)?e:"dark"===e?"obsidian":"light"===e?"dekoor":i}let f="dekoor-theme";function p(e){if("u"<typeof document)return;let t=d(e),r=document.documentElement;r.dataset.theme=e,r.classList.toggle("dark",t.isDark);let a=document.querySelector('meta[name="theme-color"]');a||((a=document.createElement("meta")).name="theme-color",document.head.appendChild(a)),a.content=t.isDark?t.swatches.bg:t.swatches.primary}let m=(0,r.createContext)(null);e.s(["ThemeProvider",0,function({children:e}){let[u,y]=(0,r.useState)(i),h=(0,r.useRef)(null),b=(0,r.useRef)(!1),g=(0,r.useRef)(null);(0,r.useEffect)(()=>{let e=null;try{e=localStorage.getItem(f)}catch{}let t=c(e);y(t),p(t)},[]),(0,r.useEffect)(()=>(0,l.f)(async e=>{if(g.current=e?.uid??null,!e){h.current=null;return}if(h.current!==e.uid){h.current=e.uid;try{let t=await (0,n.H)((0,a.f)(o.db,"users",e.uid)),r=t.exists()?t.data().theme:void 0;if(!r||b.current)return;let l=c(r);y(l),p(l);try{localStorage.setItem(f,l)}catch{}}catch{}}}),[]);let v=(0,r.useCallback)(e=>{b.current=!0,y(e),p(e);try{localStorage.setItem(f,e)}catch{}let t=g.current;t&&(0,n.r)((0,a.f)(o.db,"users",t),{theme:e},{merge:!0}).catch(()=>{})},[]),x={theme:u,meta:d(u),setTheme:v,themes:s,isDark:d(u).isDark};return(0,t.jsx)(m.Provider,{value:x,children:e})},"useTheme",0,function(){let e=(0,r.useContext)(m);if(!e)throw Error("useTheme debe usarse dentro de <ThemeProvider>");return e}],25790)}])})();