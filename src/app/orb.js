// O "rosto" da Aurora: um orbe de luz líquida (WebGL, sem bibliotecas).
// Fala → amplitude/forma por visema; escuta → nível do microfone; pensando → redemoinho violeta.
import { ambientOn, reducedMotion, session } from './state.js';
import { micLevel, mouth } from './voice.js';

const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
// Ruído simplex 3D: Ian McEwan / Ashima Arts (MIT).
const FRAG = `precision highp float;
uniform vec2 uRes;uniform float uTime,uAmp,uWide,uRound,uThink,uListen;
uniform vec3 uA,uB,uC;
vec3 m289(vec3 x){return x-floor(x*(1./289.))*289.;}vec4 m289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 perm(vec4 x){return m289(((x*34.)+1.)*x);}vec4 tis(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;
vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
i=m289(i);vec4 p=perm(perm(perm(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
vec4 nm=tis(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=nm.x;p1*=nm.y;p2*=nm.z;p3*=nm.w;
vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;
return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*uRes)/min(uRes.x,uRes.y);
  uv.x/=1.+.07*uWide-.05*uRound; uv.y/=1.+.09*uAmp;
  float r=length(uv),a=atan(uv.y,uv.x),t=uTime;
  float n1=snoise(vec3(cos(a)*.9,sin(a)*.9,t*.35+uThink*t*.4));
  float n2=snoise(vec3(cos(a)*2.3,sin(a)*2.3,t*.7+5.));
  float R=.29+(.012+.06*uAmp+.012*uListen)*n1+(.006+.028*uAmp)*n2;
  float inside=smoothstep(R+.004,R-.008,r);
  vec3 q=vec3(uv*2.4,t*.22);
  float f=snoise(q+.7*snoise(q*1.4+vec3(0.,0.,t*.15)));
  float g=snoise(q*.8+vec3(3.,1.,-t*.1));
  vec3 col=mix(uA,uB,smoothstep(-.55,.65,f));
  col=mix(col,uC,clamp(smoothstep(.1,.9,g)*.55+uThink*.45,0.,1.));
  float depth=1.-r/max(R,.001);
  col*=.45+.75*depth;
  col+=uB*smoothstep(R-.1,R,r)*.35*inside;
  col+=vec3(1.)*.22*smoothstep(.16,0.,length(uv-vec2(-.085,.11)))*inside;
  float halo=exp(-max(r-R,0.)*16.)*(.22+.55*uAmp+.25*uListen)*(1.-inside);
  vec3 outc=col*inside+uB*halo;
  gl_FragColor=vec4(outc,clamp(inside+halo,0.,1.));
}`;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const PALETTE = { a: hex('#0f5c34'), b: hex('#46f0c4'), c: hex('#8b5cf6') };

export function createOrb(canvas) {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: true });
  const cv = { amp: 0, wide: 0, round: 0, think: 0, listen: 0, t: 0 };
  const ease = (c, tgt, rate, dt) => c + (tgt - c) * (1 - Math.exp(-rate * dt));
  let W = 0, H = 0, visible = true;

  function resize() {
    const r = canvas.getBoundingClientRect(), q = Math.min(devicePixelRatio || 1, 2);
    W = Math.max(2, Math.round(r.width * q)); H = Math.max(2, Math.round(r.height * q));
    canvas.width = W; canvas.height = H;
    if (gl) gl.viewport(0, 0, W, H);
  }
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
  resize();

  let draw;
  if (gl) {
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {};
    for (const n of ['uRes', 'uTime', 'uAmp', 'uWide', 'uRound', 'uThink', 'uListen', 'uA', 'uB', 'uC']) U[n] = gl.getUniformLocation(prog, n);
    gl.uniform3fv(U.uA, PALETTE.a); gl.uniform3fv(U.uB, PALETTE.b); gl.uniform3fv(U.uC, PALETTE.c);
    gl.clearColor(0, 0, 0, 0);
    draw = () => {
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(U.uRes, W, H); gl.uniform1f(U.uTime, cv.t);
      gl.uniform1f(U.uAmp, cv.amp); gl.uniform1f(U.uWide, cv.wide); gl.uniform1f(U.uRound, cv.round);
      gl.uniform1f(U.uThink, cv.think); gl.uniform1f(U.uListen, cv.listen);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
  } else {
    // alternativa sem WebGL: gradientes em Canvas 2D
    const c2 = canvas.getContext('2d');
    draw = () => {
      c2.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2, R = Math.min(W, H) * (0.29 + 0.05 * cv.amp);
      const g = c2.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R);
      g.addColorStop(0, 'rgba(120,255,214,1)'); g.addColorStop(0.55, 'rgba(31,139,76,1)'); g.addColorStop(1, `rgba(139,92,246,${0.6 + 0.4 * cv.think})`);
      c2.save(); c2.translate(cx, cy); c2.scale(1 + 0.07 * cv.wide, 1 + 0.09 * cv.amp); c2.translate(-cx, -cy);
      c2.fillStyle = g; c2.beginPath(); c2.arc(cx, cy, R, 0, Math.PI * 2); c2.fill(); c2.restore();
    };
  }

  /** Um quadro. Chamado pelo loop principal. */
  function frame(dt) {
    if (!visible || !W) return;
    const st = session.state, speaking = session.speaking;
    const m = mouth();
    const mic = st === 'listening' ? micLevel() : 0;
    const k = reducedMotion() ? 0.4 : 1;
    cv.amp = ease(cv.amp, (speaking ? m[0] : mic * 0.8) * k, speaking ? 18 : 10, dt);
    cv.wide = ease(cv.wide, speaking ? Math.max(0, m[1]) * k : 0, 14, dt);
    cv.round = ease(cv.round, speaking ? Math.max(0, -m[1]) * k : 0, 14, dt);
    cv.think = ease(cv.think, st === 'thinking' ? 1 : 0, 4, dt);
    cv.listen = ease(cv.listen, st === 'listening' && Date.now() < session.awakeUntil ? 1 : 0, 5, dt);
    // movimento ambiente pode ser pausado no ⚙ (e para com prefers-reduced-motion)
    if (ambientOn() || speaking || st === 'thinking') cv.t += dt * (0.6 + cv.think * 1.4 + cv.amp * 0.8);
    draw();
  }
  return { frame, webgl: !!gl };
}
