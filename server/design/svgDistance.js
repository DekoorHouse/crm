'use strict';
// Squared Euclidean distance to colored geometry; units supplied by the SVG renderer.
function lineDistance(f) {
    const n=f.length, v=new Int32Array(n), z=new Float64Array(n+1), d=new Float64Array(n);
    let k=0; z[0]=-Infinity; z[1]=Infinity;
    for(let q=1;q<n;q++) {
        let s;
        do { const p=v[k]; s=((f[q]+q*q)-(f[p]+p*p))/(2*(q-p)); if(s<=z[k])k--;else break; } while(k>=0);
        if(k<0){k=0;v[0]=q;z[0]=-Infinity;z[1]=Infinity;}
        else{k++;v[k]=q;z[k]=s;z[k+1]=Infinity;}
    }
    k=0;for(let q=0;q<n;q++){while(z[k+1]<q)k++;d[q]=(q-v[k])**2+f[v[k]];}
    return d;
}
function distanceMap(image) {
    const {width:w,height:h,pixels}=image, data=new Float32Array(w*h), f=new Float64Array(Math.max(w,h));
    for(let y=0;y<h;y++){
        for(let x=0;x<w;x++){
            const p=(y*w+x)*4,r=pixels[p],g=pixels[p+1],b=pixels[p+2];
            f[x]=(b>r+30&&b>g+20)||(r>b+30&&r>g+30)?0:1e12;
        }
        data.set(lineDistance(f.subarray(0,w)),y*w);
    }
    for(let x=0;x<w;x++){
        for(let y=0;y<h;y++)f[y]=data[y*w+x];
        const d=lineDistance(f.subarray(0,h));
        for(let y=0;y<h;y++)data[y*w+x]=d[y];
    }
    return {width:w,height:h,data};
}
module.exports={distanceMap,lineDistance};
