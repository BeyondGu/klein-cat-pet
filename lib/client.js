/**
 * 克莱恩猫宠物 · 浏览器端 bundle
 *
 * 契约（DSH 客户端插件）：
 *   window.__ModuleLoader__.load({ id, factory })  →  factory(require) 返回
 *   { name, inject, apply }，由宿主在服务就绪后调用 apply(ctx)。
 *
 * 这里刻意手写 bundle、不引入构建器：整个宠物就是 React + 内联 SVG + CSS，
 * 音效用 Web Audio 实时合成，不依赖任何外部图片/音频文件。
 */
window.__ModuleLoader__.load({
  id: "dsh-klein-cat-pet",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require("react");
    const h = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;
    const useRef = React.useRef;

    // ─────────────────────────────────────────────────────────────
    // 常量与纯函数
    // ─────────────────────────────────────────────────────────────

    const STORAGE_KEY = "klein-cat-pet:v1";
    const STATES = ["work", "tired", "rest"];
    const LABELS = {
      work: "努力工作中",
      tired: "累了",
      rest: "休息中",
    };
    const HINTS = {
      work: "黄水晶占卜中……",
      tired: "摸鱼打瞌睡中……",
      rest: "正在喝甜冰茶……",
    };
    const DEFAULT_POS = { xPct: 1, yPct: 1 };
    const DEFAULT_STATE = {
      state: "work",
      xPct: DEFAULT_POS.xPct,
      yPct: DEFAULT_POS.yPct,
      muted: false,
      visible: true,
    };
    const PET_W = 168;
    const PET_H = 220;
    const MARGIN = 16;

    function clamp01(n) {
      if (typeof n !== "number" || !isFinite(n)) return 1;
      return Math.min(1, Math.max(0, n));
    }

    function nextState(state) {
      const i = STATES.indexOf(state);
      return STATES[(i < 0 ? 0 : i + 1) % STATES.length];
    }

    function normalize(raw) {
      const src = raw && typeof raw === "object" ? raw : {};
      return {
        state: STATES.indexOf(src.state) >= 0 ? src.state : DEFAULT_STATE.state,
        xPct: clamp01(Number(src.xPct)),
        yPct: clamp01(Number(src.yPct)),
        muted: src.muted === true,
        visible: src.visible !== false,
      };
    }

    function layout(pct, vw, vh) {
      const maxX = Math.max(0, vw - PET_W - MARGIN * 2);
      const maxY = Math.max(0, vh - PET_H - MARGIN * 2);
      return {
        left: MARGIN + clamp01(Number(pct && pct.xPct)) * maxX,
        top: MARGIN + clamp01(Number(pct && pct.yPct)) * maxY,
        maxX: maxX,
        maxY: maxY,
      };
    }

    function readStored() {
      try {
        if (typeof window === "undefined" || !window.localStorage) return null;
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return normalize(JSON.parse(raw));
      } catch (error) {
        return null;
      }
    }

    function writeStored(snapshot) {
      try {
        if (typeof window === "undefined" || !window.localStorage) return;
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      } catch (error) {
        /* 隐私模式/配额满：退化为内存态 */
      }
    }

    function createStore() {
      let state = readStored() || Object.assign({}, DEFAULT_STATE);
      const listeners = new Set();
      const onStorage = (event) => {
        if (event.key !== STORAGE_KEY || !event.newValue) return;
        try {
          state = normalize(JSON.parse(event.newValue));
        } catch (error) {
          return;
        }
        listeners.forEach((fn) => fn());
      };
      if (typeof window !== "undefined") {
        window.addEventListener("storage", onStorage);
      }
      return {
        get: () => state,
        subscribe(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        set(patch, persist) {
          state = Object.assign({}, state, patch);
          if (persist !== false) writeStored(state);
          listeners.forEach((fn) => fn());
        },
        dispose() {
          listeners.clear();
          if (typeof window !== "undefined") {
            window.removeEventListener("storage", onStorage);
          }
        },
      };
    }

    // ─────────────────────────────────────────────────────────────
    // 音效：Web Audio 实时合成（无音频文件、无网络请求）
    // ─────────────────────────────────────────────────────────────

    let audioEngine = null;

    function createAudioEngine() {
      let ctx = null;
      let master = null;
      let noiseBuffer = null;
      let muted = false;
      const active = new Set();

      function ensure() {
        if (ctx) return ctx;
        const AC =
          typeof window !== "undefined" &&
          (window.AudioContext || window.webkitAudioContext);
        if (!AC) return null;
        try {
          ctx = new AC();
          master = ctx.createGain();
          master.gain.value = muted ? 0 : 0.5;
          master.connect(ctx.destination);
          const length = Math.floor(ctx.sampleRate * 2);
          noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
          const data = noiseBuffer.getChannelData(0);
          for (let i = 0; i < length; i += 1) {
            data[i] = Math.random() * 2 - 1;
          }
        } catch (error) {
          ctx = null;
          master = null;
          return null;
        }
        return ctx;
      }

      function track(source) {
        active.add(source);
        source.onended = () => active.delete(source);
      }

      function tone(t0, dur, freq, gain, type, freqEnd) {
        const osc = ctx.createOscillator();
        osc.type = type || "sine";
        osc.frequency.setValueAtTime(freq, t0);
        if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g);
        g.connect(master);
        osc.start(t0);
        osc.stop(t0 + dur + 0.05);
        track(osc);
      }

      function bell(t0, freq, gain, dur) {
        tone(t0, dur, freq, gain, "sine");
        tone(t0, dur * 0.55, freq * 2.01, gain * 0.35, "sine");
      }

      function noise(t0, dur, options) {
        const opts = options || {};
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = opts.type || "bandpass";
        filter.frequency.setValueAtTime(opts.freq || 1200, t0);
        if (opts.freqEnd) {
          filter.frequency.exponentialRampToValueAtTime(opts.freqEnd, t0 + dur);
        }
        filter.Q.value = opts.q == null ? 1 : opts.q;
        const g = ctx.createGain();
        const attack = opts.attack == null ? 0.02 : opts.attack;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(opts.gain || 0.06, t0 + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(filter);
        filter.connect(g);
        g.connect(master);
        src.start(t0);
        src.stop(t0 + dur + 0.05);
        track(src);
      }

      function playWork(t) {
        // 黄水晶铃音：三枚清亮泛音 + 高频微光 + 低音垫底
        bell(t, 1318.51, 0.2, 1.5);
        bell(t + 0.035, 1975.53, 0.12, 1.2);
        bell(t + 0.07, 2637.02, 0.06, 0.9);
        bell(t, 659.25, 0.05, 1.9);
        bell(t + 0.16, 1760.0, 0.05, 0.8);
        noise(t, 0.5, { type: "highpass", freq: 6200, gain: 0.028, attack: 0.02 });
      }

      function playTired(t) {
        // 两轮呼噜：吸气（带通噪声上扫）+ 呼气（低频锯齿 + 13Hz 颤抖）
        for (let i = 0; i < 2; i += 1) {
          const base = t + i * 1.6;
          noise(base, 0.55, {
            type: "bandpass",
            freq: 480,
            freqEnd: 900,
            q: 1.4,
            gain: 0.045,
            attack: 0.16,
          });
          const osc = ctx.createOscillator();
          osc.type = "sawtooth";
          osc.frequency.setValueAtTime(74, base + 0.3);
          osc.frequency.linearRampToValueAtTime(58, base + 1.25);
          const filter = ctx.createBiquadFilter();
          filter.type = "lowpass";
          filter.frequency.value = 260;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, base + 0.3);
          g.gain.linearRampToValueAtTime(0.16, base + 0.46);
          g.gain.exponentialRampToValueAtTime(0.0001, base + 1.35);
          const lfo = ctx.createOscillator();
          lfo.frequency.value = 13;
          const lfoGain = ctx.createGain();
          lfoGain.gain.value = 0.05;
          lfo.connect(lfoGain);
          lfoGain.connect(g.gain);
          osc.connect(filter);
          filter.connect(g);
          g.connect(master);
          osc.start(base + 0.3);
          osc.stop(base + 1.4);
          lfo.start(base + 0.3);
          lfo.stop(base + 1.4);
          track(osc);
          track(lfo);
          noise(base + 0.32, 1.0, {
            type: "lowpass",
            freq: 330,
            gain: 0.06,
            attack: 0.18,
          });
        }
      }

      function playRest(t) {
        // 冰块轻碰 + 吸管吸吮（带通下扫）+ 三颗气泡
        bell(t, 2860.0, 0.04, 0.16);
        bell(t + 0.05, 3410.0, 0.03, 0.13);
        noise(t + 0.08, 0.52, {
          type: "bandpass",
          freq: 1600,
          freqEnd: 680,
          q: 2.6,
          gain: 0.08,
          attack: 0.03,
        });
        const bubbles = [520, 690, 840];
        for (let i = 0; i < bubbles.length; i += 1) {
          const at = t + 0.44 + i * 0.16;
          tone(at, 0.13, bubbles[i], 0.05, "sine", bubbles[i] * 1.35);
        }
      }

      function play(state, isMuted) {
        if (isMuted || muted) return;
        const c = ensure();
        if (!c) return;
        if (c.state === "suspended") {
          try {
            c.resume();
          } catch (error) {
            /* 忽略 */
          }
        }
        // 上一段音效快速淡出，避免连点叠音
        if (master) {
          const now = c.currentTime;
          master.gain.cancelScheduledValues(now);
          master.gain.setTargetAtTime(0.5, now, 0.012);
        }
        for (const source of Array.from(active)) {
          try {
            source.stop(c.currentTime + 0.02);
          } catch (error) {
            /* 已停止 */
          }
        }
        const t0 = c.currentTime + 0.03;
        if (state === "work") playWork(t0);
        else if (state === "tired") playTired(t0);
        else playRest(t0);
      }

      function setMuted(value) {
        muted = value === true;
        if (ctx && master) {
          master.gain.cancelScheduledValues(ctx.currentTime);
          master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.02);
        }
      }

      function stop() {
        if (!ctx) return;
        for (const source of Array.from(active)) {
          try {
            source.stop(ctx.currentTime + 0.02);
          } catch (error) {
            /* 已停止 */
          }
        }
      }

      function dispose() {
        stop();
        active.clear();
        if (ctx && ctx.state !== "closed") {
          try {
            ctx.close();
          } catch (error) {
            /* 忽略 */
          }
        }
        ctx = null;
        master = null;
        noiseBuffer = null;
      }

      return { play, setMuted, stop, dispose };
    }

    function getAudioEngine() {
      if (!audioEngine) audioEngine = createAudioEngine();
      return audioEngine;
    }

    // ─────────────────────────────────────────────────────────────
    // 图标（内联 SVG，不依赖 emoji 字体）
    // ─────────────────────────────────────────────────────────────

    const ICON_UNMUTE =
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h2.4L9 3.4v9.2L5.4 10H3z"/><path d="M11.4 5.8a3.2 3.2 0 0 1 0 4.4M13.2 4.4a5.4 5.4 0 0 1 0 7.2"/></svg>';
    const ICON_MUTE =
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h2.4L9 3.4v9.2L5.4 10H3z"/><path d="M11.2 6.2l3.4 3.4M14.6 6.2l-3.4 3.4"/></svg>';
    const ICON_RESET =
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5"/><path d="M3 3.2v3h3"/></svg>';
    const ICON_HIDE =
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l10 10"/><path d="M6.4 6.5A6.2 6.2 0 0 0 2.8 8s2.1 3.2 5.2 3.2c.9 0 1.7-.2 2.4-.6M8.2 4.8C10.9 5.1 13.2 8 13.2 8a8.7 8.7 0 0 1-2.1 2"/></svg>';
    const PAW_ICON =
      '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><ellipse cx="4.8" cy="7.4" rx="1.9" ry="2.5"/><ellipse cx="8.7" cy="4.9" rx="2" ry="2.8"/><ellipse cx="12.9" cy="5.1" rx="2" ry="2.8"/><ellipse cx="16.2" cy="7.8" rx="1.8" ry="2.3"/><path d="M10.4 9.4c2.8 0 5.2 2 5.2 4.1 0 1.6-1.3 2.6-3.1 2.6-1 0-1.6-.3-2.2-.3s-1.2.3-2.2.3c-1.8 0-3.1-1-3.1-2.6 0-2.1 2.5-4.1 5.4-4.1z"/></svg>';

    // ─────────────────────────────────────────────────────────────
    // 三套场景（内联 SVG）
    // ─────────────────────────────────────────────────────────────

    const ART_WORK =
      '<defs>' +
      '<linearGradient id="kcw-fur" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2838"/><stop offset=".55" stop-color="#17151f"/><stop offset="1" stop-color="#0a0910"/></linearGradient>' +
      '<radialGradient id="kcw-glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffe08a" stop-opacity=".95"/><stop offset=".4" stop-color="#f6c443" stop-opacity=".38"/><stop offset="1" stop-color="#f6c443" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="kcw-gem" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff8cc"/><stop offset=".48" stop-color="#f8ca52"/><stop offset="1" stop-color="#a56c10"/></linearGradient>' +
      '</defs>' +
      '<ellipse cx="80" cy="167" rx="42" ry="6" fill="#000" opacity=".42"/>' +
      '<ellipse cx="80" cy="164" rx="56" ry="9" fill="#b9c6da" opacity=".05"/>' +
      '<g class="kc-cat">' +
      '<g class="kc-tail"><path d="M104 150 C132 155 146 137 134 119" fill="none" stroke="url(#kcw-fur)" stroke-width="12" stroke-linecap="round"/></g>' +
      '<path d="M50 104 C46 132 56 154 80 156 C104 154 114 132 110 104 Z" fill="url(#kcw-fur)"/>' +
      '<ellipse cx="80" cy="139" rx="19" ry="20" fill="#262333" opacity=".55"/>' +
      '<ellipse cx="66" cy="160" rx="9" ry="5.5" fill="#2b2838"/>' +
      '<ellipse cx="94" cy="160" rx="9" ry="5.5" fill="#2b2838"/>' +
      '<g class="kc-head">' +
      '<path d="M52 57 L46 27 L72 46 Z" fill="url(#kcw-fur)"/>' +
      '<path d="M55 53 L51 35 L65 46 Z" fill="#5b3a47"/>' +
      '<path d="M108 57 L114 27 L88 46 Z" fill="url(#kcw-fur)"/>' +
      '<path d="M105 53 L109 35 L95 46 Z" fill="#5b3a47"/>' +
      '<ellipse cx="80" cy="78" rx="32" ry="29" fill="url(#kcw-fur)"/>' +
      '<path d="M56 63 Q62 53 72 57" stroke="#50566b" stroke-width="1.2" fill="none" opacity=".55"/>' +
      '<path d="M104 63 Q98 53 88 57" stroke="#50566b" stroke-width="1.2" fill="none" opacity=".4"/>' +
      '<g class="kc-eyes">' +
      '<ellipse cx="67" cy="79" rx="8" ry="9" fill="#ffcf5c"/>' +
      '<ellipse cx="67" cy="79" rx="2.1" ry="7.4" fill="#171018"/>' +
      '<circle cx="64.4" cy="75.5" r="1.9" fill="#fff6d8" opacity=".95"/>' +
      '<ellipse cx="93" cy="79" rx="8" ry="9" fill="#ffcf5c"/>' +
      '<ellipse cx="93" cy="79" rx="2.1" ry="7.4" fill="#171018"/>' +
      '<circle cx="90.4" cy="75.5" r="1.9" fill="#fff6d8" opacity=".95"/>' +
      '</g>' +
      '<path d="M77 90 L83 90 L80 94 Z" fill="#c0818e"/>' +
      '<path d="M80 94 Q75 99 71 96 M80 94 Q85 99 89 96" stroke="#4a3038" stroke-width="1.2" fill="none" stroke-linecap="round"/>' +
      '<g stroke="#8f8a9e" stroke-width="1" opacity=".45" stroke-linecap="round">' +
      '<path d="M54 85 L38 82"/><path d="M54 89 L38 90"/><path d="M54 93 L40 98"/>' +
      '<path d="M106 85 L122 82"/><path d="M106 89 L122 90"/><path d="M106 93 L120 98"/>' +
      '</g>' +
      '<g class="kc-hat">' +
      '<ellipse cx="80" cy="50" rx="31" ry="7" fill="#08070c"/>' +
      '<path d="M59 50 C61 32 63 18 68 15 C74 11 86 11 92 15 C97 18 99 32 101 50 Z" fill="#121018"/>' +
      '<path d="M62 44 Q80 50 98 44 L97 49 Q80 55 63 49 Z" fill="#8a6a2f"/>' +
      '<rect x="75.5" y="43.5" width="9" height="6.5" rx="1.2" fill="#1a1610" stroke="#e3c174" stroke-width="1"/>' +
      '<path d="M70 20 Q80 15 90 20" stroke="#3a3546" stroke-width="1.5" fill="none" opacity=".8"/>' +
      '</g>' +
      '<g class="kc-chain"><path d="M96 47 Q103 53 105 58" stroke="#c9a44f" stroke-width="1" fill="none" stroke-dasharray="1 2"/><circle cx="105" cy="60" r="3.2" fill="#d9b96a"/><circle cx="105" cy="60" r="1.2" fill="#3a2c12"/></g>' +
      '<path d="M80 108 l-8 -4 v8 z" fill="#7a2733"/><path d="M80 108 l8 -4 v8 z" fill="#7a2733"/><circle cx="80" cy="108" r="2.4" fill="#b8434f"/>' +
      '</g>' +
      '<g class="kc-arm">' +
      '<path d="M98 128 C108 123 112 112 110 103" fill="none" stroke="url(#kcw-fur)" stroke-width="12" stroke-linecap="round"/>' +
      '<ellipse cx="110" cy="101" rx="7.5" ry="6" fill="#2b2838"/>' +
      '<path d="M106 98 Q110 95.5 114 98" stroke="#4c5062" stroke-width="1.1" fill="none" opacity=".7"/>' +
      '<path d="M110 104 Q118 100 124 98" stroke="#d9b96a" stroke-width="1.1" fill="none" stroke-dasharray="1.4 2.4"/>' +
      '</g>' +
      '<g class="kc-crystal">' +
      '<circle cx="128" cy="110" r="27" fill="url(#kcw-glow)" class="kc-glow"/>' +
      '<polygon points="128,92 140,109 128,128 116,109" fill="url(#kcw-gem)"/>' +
      '<polygon points="128,92 128,128 116,109" fill="#fff0a6" opacity=".55"/>' +
      '<polygon points="128,92 140,109 128,109" fill="#ffe38a" opacity=".9"/>' +
      '<polygon points="128,109 140,109 128,128" fill="#c98f1e" opacity=".7"/>' +
      '<polygon points="128,109 116,109 128,128" fill="#a97414" opacity=".5"/>' +
      '<path d="M128 92 L128 128" stroke="#fffbe0" stroke-width=".6" opacity=".6"/>' +
      '</g>' +
      '<g class="kc-circle" opacity=".8">' +
      '<ellipse cx="128" cy="134" rx="25" ry="7.5" fill="none" stroke="#d9b96a" stroke-width="1" stroke-dasharray="2 4"/>' +
      '<ellipse cx="128" cy="134" rx="18" ry="5.2" fill="none" stroke="#d9b96a" stroke-width=".7" opacity=".6"/>' +
      '<circle cx="128" cy="134" r="1.5" fill="#ffd45e"/>' +
      '<path d="M106 132 v4 M150 132 v4 M128 126 v3 M128 139 v3" stroke="#d9b96a" stroke-width=".8" opacity=".7"/>' +
      '</g>' +
      '<g class="kc-sparkles">' +
      '<g class="kc-spark s1" transform="translate(145 95) scale(.9)"><path d="M0 -6 L1.4 -1.4 L6 0 L1.4 1.4 L0 6 L-1.4 1.4 L-6 0 L-1.4 -1.4 Z" fill="#ffe9a6"/></g>' +
      '<g class="kc-spark s2" transform="translate(113 84) scale(.7)"><path d="M0 -6 L1.4 -1.4 L6 0 L1.4 1.4 L0 6 L-1.4 1.4 L-6 0 L-1.4 -1.4 Z" fill="#ffe9a6"/></g>' +
      '<g class="kc-spark s3" transform="translate(150 120) scale(.65)"><path d="M0 -6 L1.4 -1.4 L6 0 L1.4 1.4 L0 6 L-1.4 1.4 L-6 0 L-1.4 -1.4 Z" fill="#ffe9a6"/></g>' +
      '<g class="kc-spark s4" transform="translate(122 79) scale(.55)"><path d="M0 -6 L1.4 -1.4 L6 0 L1.4 1.4 L0 6 L-1.4 1.4 L-6 0 L-1.4 -1.4 Z" fill="#fff6c2"/></g>' +
      '</g>' +
      '</g>';

    const ART_TIRED =
      '<defs>' +
      '<linearGradient id="kct-fur" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2838"/><stop offset=".55" stop-color="#17151f"/><stop offset="1" stop-color="#0a0910"/></linearGradient>' +
      '</defs>' +
      '<ellipse cx="80" cy="167" rx="48" ry="6" fill="#000" opacity=".42"/>' +
      '<ellipse cx="80" cy="164" rx="58" ry="9" fill="#b9c6da" opacity=".05"/>' +
      '<g class="kc-cat">' +
      '<g class="kc-tail"><path d="M106 150 C132 157 146 138 128 127" fill="none" stroke="url(#kct-fur)" stroke-width="12" stroke-linecap="round"/></g>' +
      '<path d="M44 128 C42 150 58 162 80 162 C102 162 118 150 116 128 Z" fill="url(#kct-fur)"/>' +
      '<ellipse cx="80" cy="147" rx="24" ry="13" fill="#262333" opacity=".5"/>' +
      '<ellipse cx="56" cy="159" rx="16" ry="7" fill="#2b2838"/>' +
      '<ellipse cx="102" cy="159" rx="16" ry="7" fill="#2b2838"/>' +
      '<g class="kc-head">' +
      '<g class="kc-breathe">' +
      '<path d="M51 96 L38 89 L57 82 Z" fill="url(#kct-fur)"/>' +
      '<path d="M105 96 L118 89 L99 82 Z" fill="url(#kct-fur)"/>' +
      '<path d="M53 92 L45 88 L56 84 Z" fill="#5b3a47" opacity=".8"/>' +
      '<path d="M103 92 L111 88 L100 84 Z" fill="#5b3a47" opacity=".8"/>' +
      '<ellipse cx="78" cy="110" rx="33" ry="28" fill="url(#kct-fur)"/>' +
      '<path d="M56 103 Q62 98 70 101" stroke="#50566b" stroke-width="1" fill="none" opacity=".5"/>' +
      '<path d="M100 103 Q94 98 86 101" stroke="#50566b" stroke-width="1" fill="none" opacity=".4"/>' +
      '<path d="M55 111 Q63 118 71 111" stroke="#d9b96a" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
      '<path d="M85 111 Q93 118 101 111" stroke="#d9b96a" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
      '<path d="M75 120 L81 120 L78 124 Z" fill="#c0818e"/>' +
      '<path d="M78 124 Q73 128 70 126 M78 124 Q83 128 86 126" stroke="#4a3038" stroke-width="1.2" fill="none" stroke-linecap="round"/>' +
      '<g stroke="#8f8a9e" stroke-width="1" opacity=".4" stroke-linecap="round"><path d="M50 116 L36 114"/><path d="M50 120 L36 122"/><path d="M106 116 L120 114"/><path d="M106 120 L120 122"/></g>' +
      '<g class="kc-hat" transform="rotate(-10 78 84)">' +
      '<ellipse cx="78" cy="84" rx="30" ry="6.5" fill="#08070c"/>' +
      '<path d="M58 84 C60 68 62 55 67 52 C73 48 84 48 90 52 C95 55 97 68 99 84 Z" fill="#121018"/>' +
      '<path d="M61 78 Q78 83 95 78 L94 83 Q78 88 62 83 Z" fill="#8a6a2f"/>' +
      '<rect x="73.5" y="77.5" width="9" height="6" rx="1.2" fill="#1a1610" stroke="#e3c174" stroke-width="1"/>' +
      '</g>' +
      '<path d="M78 137 l-7 -3.6 v7.2 z" fill="#7a2733"/><path d="M78 137 l7 -3.6 v7.2 z" fill="#7a2733"/><circle cx="78" cy="137" r="2.2" fill="#b8434f"/>' +
      '</g>' +
      '</g>' +
      '<g class="kc-zzz" fill="#d9c08a" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-weight="600">' +
      '<text class="kc-z z1" x="116" y="96" font-size="10">Z</text>' +
      '<text class="kc-z z2" x="127" y="80" font-size="13">Z</text>' +
      '<text class="kc-z z3" x="139" y="62" font-size="16">Z</text>' +
      '</g>' +
      '</g>';

    const ART_REST =
      '<defs>' +
      '<linearGradient id="kcr-fur" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2838"/><stop offset=".55" stop-color="#17151f"/><stop offset="1" stop-color="#0a0910"/></linearGradient>' +
      '</defs>' +
      '<ellipse cx="84" cy="168" rx="50" ry="6" fill="#000" opacity=".42"/>' +
      '<ellipse cx="84" cy="165" rx="58" ry="9" fill="#b9c6da" opacity=".05"/>' +
      '<g class="kc-cat">' +
      '<g class="kc-tail"><path d="M44 152 C24 148 20 130 32 122" fill="none" stroke="url(#kcr-fur)" stroke-width="12" stroke-linecap="round"/></g>' +
      '<ellipse cx="94" cy="156" rx="48" ry="12" fill="#4a2733"/>' +
      '<rect x="54" y="142" width="82" height="18" rx="9" fill="#3b2029"/>' +
      '<path d="M48 118 C46 144 62 158 90 158 C114 158 126 144 124 122 Z" fill="url(#kcr-fur)"/>' +
      '<ellipse cx="88" cy="146" rx="24" ry="13" fill="#262333" opacity=".5"/>' +
      '<g class="kc-head" transform="rotate(-6 64 96)">' +
      '<path d="M37 78 L28 58 L52 68 Z" fill="url(#kcr-fur)"/>' +
      '<path d="M90 78 L99 58 L76 68 Z" fill="url(#kcr-fur)"/>' +
      '<path d="M40 75 L34 63 L49 69 Z" fill="#5b3a47" opacity=".8"/>' +
      '<path d="M87 75 L93 63 L78 69 Z" fill="#5b3a47" opacity=".8"/>' +
      '<ellipse cx="64" cy="96" rx="30" ry="27" fill="url(#kcr-fur)"/>' +
      '<path d="M42 90 Q48 85 56 88" stroke="#50566b" stroke-width="1" fill="none" opacity=".5"/>' +
      '<path d="M86 90 Q80 85 72 88" stroke="#50566b" stroke-width="1" fill="none" opacity=".4"/>' +
      '<path d="M45 97 Q52 104 59 97" stroke="#d9b96a" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
      '<path d="M70 97 Q77 104 84 97" stroke="#d9b96a" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
      '<ellipse cx="42" cy="105" rx="5" ry="2.4" fill="#c86a7a" opacity=".28"/>' +
      '<ellipse cx="86" cy="105" rx="5" ry="2.4" fill="#c86a7a" opacity=".22"/>' +
      '<path d="M61 107 L67 107 L64 111 Z" fill="#c0818e"/>' +
      '<path d="M64 111 Q60 116 57 113 M64 111 Q68 116 71 113" stroke="#4a3038" stroke-width="1.1" fill="none" stroke-linecap="round"/>' +
      '<g stroke="#8f8a9e" stroke-width="1" opacity=".4" stroke-linecap="round"><path d="M38 101 L24 99"/><path d="M38 105 L25 108"/><path d="M90 101 L104 99"/><path d="M90 105 L103 108"/></g>' +
      '<g class="kc-hat" transform="rotate(-16 64 70)">' +
      '<ellipse cx="64" cy="70" rx="28" ry="6" fill="#08070c"/>' +
      '<path d="M45 70 C47 55 49 43 54 40 C60 36 70 36 76 40 C81 43 83 55 85 70 Z" fill="#121018"/>' +
      '<path d="M48 64 Q64 69 80 64 L79 69 Q64 74 49 69 Z" fill="#8a6a2f"/>' +
      '<rect x="60" y="64" width="8.5" height="5.6" rx="1.1" fill="#1a1610" stroke="#e3c174" stroke-width=".9"/>' +
      '</g>' +
      '<path d="M64 123 l-7 -3.6 v7.2 z" fill="#7a2733"/><path d="M64 123 l7 -3.6 v7.2 z" fill="#7a2733"/><circle cx="64" cy="123" r="2.2" fill="#b8434f"/>' +
      '</g>' +
      '<g class="kc-sip">' +
      '<path d="M110 142 C114 137 113 132 109 128" fill="none" stroke="url(#kcr-fur)" stroke-width="11" stroke-linecap="round"/>' +
      '<ellipse cx="108" cy="127" rx="7" ry="5.4" fill="#2b2838"/>' +
      '<g class="kc-glass">' +
      '<rect x="100" y="114" width="24" height="38" rx="5" fill="#cfe6f5" fill-opacity=".12" stroke="#cfe6f5" stroke-width="1.4" stroke-opacity=".62"/>' +
      '<ellipse cx="112" cy="114.6" rx="11.5" ry="2.3" fill="#e8f6ff" fill-opacity=".12" stroke="#e8f6ff" stroke-width="1" stroke-opacity=".55"/>' +
      '<path d="M102 128 h20 v19 a4 4 0 0 1 -4 4 h-12 a4 4 0 0 1 -4 -4 Z" fill="#c9772f" opacity=".9"/>' +
      '<path d="M102 128 h20 v6 h-20 Z" fill="#e08b3c" opacity=".55"/>' +
      '<rect x="104" y="120" width="6" height="6" rx="1" fill="#e6f6ff" opacity=".7" transform="rotate(-12 107 123)"/>' +
      '<rect x="112" y="124" width="7" height="7" rx="1" fill="#e6f6ff" opacity=".55" transform="rotate(10 115 127)"/>' +
      '<circle cx="106" cy="122" r="4.2" fill="#f3d36a" opacity=".95"/>' +
      '<path d="M106 118 a4.2 4.2 0 0 1 4.2 4.2" stroke="#fff3b0" stroke-width=".8" fill="none"/>' +
      '<path d="M112 126 C112 114 104 106 92 110" fill="none" stroke="#e26d6d" stroke-width="3" stroke-linecap="round"/>' +
      '<circle class="kc-bub b1" cx="108" cy="146" r="1.6" fill="#fff" opacity=".5"/>' +
      '<circle class="kc-bub b2" cx="114" cy="140" r="1.3" fill="#fff" opacity=".45"/>' +
      '<circle class="kc-bub b3" cx="105" cy="142" r="1.1" fill="#fff" opacity=".4"/>' +
      '</g>' +
      '<ellipse cx="101" cy="133" rx="5.4" ry="4.4" fill="#2b2838"/>' +
      '<path d="M97.5 131 Q101.5 129 105.5 131" stroke="#4c5062" stroke-width="1" fill="none" opacity=".7"/>' +
      '<path class="kc-heart" d="M132 104 c-2 -3 -7 -1 -6 3 c.7 2.6 6 6 6 6 s5.3 -3.4 6 -6 c1 -4 -4 -6 -6 -3 z" fill="#e07a8a" opacity=".55"/>' +
      '</g>' +
      '</g>';

    const ART = { work: ART_WORK, tired: ART_TIRED, rest: ART_REST };

    // ─────────────────────────────────────────────────────────────
    // 样式（运行时注入，插件卸载时移除）
    // ─────────────────────────────────────────────────────────────

    const CSS =
      '.kc-pet{position:fixed;z-index:30;width:168px;padding:0;margin:0;' +
      'font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;' +
      '-webkit-user-select:none;user-select:none;touch-action:none;pointer-events:auto;outline:none}' +
      '.kc-top{height:30px;display:flex;align-items:flex-start;justify-content:center;position:relative}' +
      '.kc-bubble{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;' +
      'background:rgba(18,15,24,.84);border:1px solid rgba(217,185,106,.42);color:#f4e7c8;' +
      'font-size:11px;line-height:16px;letter-spacing:.4px;white-space:nowrap;' +
      'box-shadow:0 3px 12px rgba(0,0,0,.35);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}' +
      '.kc-dot{width:6px;height:6px;border-radius:50%;background:#ffd45e;box-shadow:0 0 7px rgba(255,212,94,.9);flex:none}' +
      '.kc-pet[data-state="tired"] .kc-dot{background:#8fa3c8;box-shadow:0 0 7px rgba(143,163,200,.9)}' +
      '.kc-pet[data-state="rest"] .kc-dot{background:#9fd3b0;box-shadow:0 0 7px rgba(159,211,176,.9)}' +
      '.kc-label{display:inline-block}' +
      '.kc-stage{position:relative;width:168px;height:189px;cursor:grab;outline:none;' +
      'transition:transform .2s ease}' +
      '.kc-stage:active{cursor:grabbing}' +
      '.kc-stage:focus-visible{outline:2px solid rgba(255,212,94,.55);outline-offset:2px;border-radius:14px}' +
      '.kc-pet:hover .kc-stage{transform:translateY(-2px)}' +
      '.kc-scene{position:relative;width:100%;height:100%;animation:kc-pop .42s cubic-bezier(.2,.9,.3,1.25)}' +
      '.kc-svg{display:block;width:100%;height:100%;overflow:visible;' +
      'filter:drop-shadow(0 12px 14px rgba(0,0,0,.35))}' +
      '.kc-tools{position:absolute;right:0;top:22px;display:flex;gap:2px;padding:3px;border-radius:10px;' +
      'background:rgba(18,15,24,.9);border:1px solid rgba(217,185,106,.35);' +
      'box-shadow:0 4px 12px rgba(0,0,0,.35);opacity:0;transform:translateY(-3px);' +
      'transition:opacity .16s ease,transform .16s ease;pointer-events:none;z-index:4}' +
      '.kc-pet:hover .kc-tools,.kc-tools:focus-within{opacity:1;transform:translateY(0);pointer-events:auto}' +
      '.kc-tool{width:20px;height:20px;display:grid;place-items:center;padding:0;border:0;border-radius:6px;' +
      'background:transparent;color:#cfc4b0;cursor:pointer}' +
      '.kc-tool:hover{background:rgba(217,185,106,.16);color:#ffe9a6}' +
      '.kc-tool svg{width:13px;height:13px}' +
      '@media (hover:none){.kc-tools{opacity:1;transform:none;pointer-events:auto}}' +
      '.kc-burst{position:absolute;left:50%;top:58%;width:0;height:0;pointer-events:none;z-index:2}' +
      '.kc-burst i{position:absolute;width:5px;height:5px;margin:-2.5px;border-radius:50%;background:#ffd45e;' +
      'box-shadow:0 0 8px #ffc94a;animation:kc-burst .62s ease-out forwards}' +
      '.kc-fog{position:absolute;left:50%;top:56%;width:64px;height:64px;margin:-32px;border-radius:50%;' +
      'background:radial-gradient(circle,rgba(186,198,214,.32),rgba(186,198,214,0) 70%);' +
      'animation:kc-fog .72s ease-out forwards;pointer-events:none;z-index:1}' +
      '.kc-tail{transform-box:view-box;transform-origin:104px 150px;animation:kc-tail 5.5s ease-in-out infinite}' +
      '.kc-pet[data-state="tired"] .kc-tail{transform-origin:108px 150px;animation-duration:8s}' +
      '.kc-pet[data-state="rest"] .kc-tail{transform-origin:44px 152px;animation-duration:6.5s}' +
      '.kc-eyes{transform-box:view-box;transform-origin:80px 79px;animation:kc-blink 6.4s infinite}' +
      '.kc-crystal{transform-box:view-box;transform-origin:128px 110px;animation:kc-crystal 4s ease-in-out infinite}' +
      '.kc-glow{transform-box:view-box;transform-origin:128px 110px;animation:kc-pulse 2.4s ease-in-out infinite}' +
      '.kc-circle{transform-box:view-box;transform-origin:128px 134px;animation:kc-spin 16s linear infinite}' +
      '.kc-sparkles{transform-box:view-box;transform-origin:128px 110px;animation:kc-spin 20s linear infinite}' +
      '.kc-spark{animation:kc-twinkle 3.2s ease-in-out infinite}' +
      '.kc-spark.s2{animation-delay:.7s}.kc-spark.s3{animation-delay:1.4s}.kc-spark.s4{animation-delay:2.1s}' +
      '.kc-cat{animation:kc-bob 3.6s ease-in-out infinite}' +
      '.kc-breathe{transform-box:view-box;transform-origin:78px 152px;animation:kc-breathe 4.4s ease-in-out infinite}' +
      '.kc-z{opacity:0;animation:kc-zzz 3.2s ease-in-out infinite}' +
      '.kc-z.z2{animation-delay:.65s}.kc-z.z3{animation-delay:1.3s}' +
      '.kc-bub{animation:kc-bub 2.8s ease-in infinite}' +
      '.kc-bub.b2{animation-delay:.9s}.kc-bub.b3{animation-delay:1.7s}' +
      '.kc-sip{transform-box:view-box;transform-origin:110px 140px;animation:kc-sip 3.6s ease-in-out infinite}' +
      '.kc-heart{animation:kc-heart 3.4s ease-in-out infinite}' +
      '.kc-paused .kc-stage,.kc-paused .kc-stage *{animation-play-state:paused!important}' +
      '.kc-paw{width:24px;height:24px;display:grid;place-items:center;padding:0;border:0;border-radius:6px;' +
      'background:transparent;color:var(--dsw-alias-text-secondary,#9797a3);cursor:pointer;position:relative}' +
      '.kc-paw:hover{background:rgba(217,185,106,.14);color:#e3c174}' +
      '.kc-paw svg{width:16px;height:16px}' +
      '.kc-paw-icon{display:grid;place-items:center;width:16px;height:16px}' +
      '.kc-paw-state{position:absolute;right:2px;bottom:2px;width:5px;height:5px;border-radius:50%;background:#ffd45e;' +
      'box-shadow:0 0 4px rgba(255,212,94,.8)}' +
      '.kc-paw[data-state="tired"] .kc-paw-state{background:#8fa3c8;box-shadow:0 0 4px rgba(143,163,200,.8)}' +
      '.kc-paw[data-state="rest"] .kc-paw-state{background:#9fd3b0;box-shadow:0 0 4px rgba(159,211,176,.8)}' +
      '.kc-paw[data-hidden="true"] .kc-paw-state{display:none}' +
      '@keyframes kc-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.5px)}}' +
      '@keyframes kc-tail{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(6deg)}}' +
      '@keyframes kc-blink{0%,91%,100%{transform:scaleY(1)}94%,96%{transform:scaleY(.08)}}' +
      '@keyframes kc-crystal{0%,100%{transform:scaleX(1) translateY(0)}50%{transform:scaleX(.8) translateY(-2px)}}' +
      '@keyframes kc-pulse{0%,100%{opacity:.62;transform:scale(.94)}50%{opacity:1;transform:scale(1.06)}}' +
      '@keyframes kc-spin{to{transform:rotate(360deg)}}' +
      '@keyframes kc-twinkle{0%,100%{opacity:.12}50%{opacity:1}}' +
      '@keyframes kc-breathe{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.035)}}' +
      '@keyframes kc-zzz{0%{opacity:0;transform:translate(0,6px) scale(.8)}25%{opacity:.9}70%{opacity:.55}100%{opacity:0;transform:translate(6px,-14px) scale(1.15)}}' +
      '@keyframes kc-bub{0%{opacity:0;transform:translateY(6px) scale(.7)}30%{opacity:.8}100%{opacity:0;transform:translateY(-14px) scale(1.1)}}' +
      '@keyframes kc-sip{0%,100%{transform:rotate(0)}50%{transform:rotate(-2.5deg)}}' +
      '@keyframes kc-heart{0%,100%{opacity:.35;transform:translateY(0)}50%{opacity:.75;transform:translateY(-3px)}}' +
      '@keyframes kc-pop{0%{transform:scale(1)}35%{transform:scale(.94,1.05)}65%{transform:scale(1.045,.965)}100%{transform:scale(1)}}' +
      '@keyframes kc-burst{0%{opacity:1;transform:rotate(var(--a)) translateX(6px) scale(1)}100%{opacity:0;transform:rotate(var(--a)) translateX(var(--d)) scale(.2)}}' +
      '@keyframes kc-fog{0%{opacity:0;transform:scale(.4)}30%{opacity:.8}100%{opacity:0;transform:scale(1.8)}}' +
      '@media (prefers-reduced-motion: reduce){' +
      '.kc-pet .kc-cat,.kc-pet .kc-tail,.kc-pet .kc-eyes,.kc-pet .kc-crystal,.kc-pet .kc-glow,' +
      '.kc-pet .kc-circle,.kc-pet .kc-sparkles,.kc-pet .kc-spark,.kc-pet .kc-breathe,.kc-pet .kc-z,' +
      '.kc-pet .kc-bub,.kc-pet .kc-sip,.kc-pet .kc-heart,.kc-pet .kc-stage,.kc-pet .kc-scene{animation:none!important}' +
      '.kc-pet .kc-stage{transition:none!important}' +
      '.kc-burst,.kc-fog{display:none!important}' +
      '}';

    // ─────────────────────────────────────────────────────────────
    // React 组件
    // ─────────────────────────────────────────────────────────────

    function useStoreValue(store) {
      const [value, setValue] = useState(store.get);
      useEffect(() => {
        return store.subscribe(() => setValue(store.get()));
      }, [store]);
      return value;
    }

    function useViewport() {
      const [size, setSize] = useState(() => ({
        w: typeof window === "undefined" ? 1280 : window.innerWidth,
        h: typeof window === "undefined" ? 800 : window.innerHeight,
      }));
      useEffect(() => {
        const onResize = () =>
          setSize({ w: window.innerWidth, h: window.innerHeight });
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
      }, []);
      return size;
    }

    function KleinCatPet(props) {
      const store = props.store;
      const snapshot = useStoreValue(store);
      const viewport = useViewport();
      const [drag, setDrag] = useState(null);
      const [bump, setBump] = useState(0);
      const [paused, setPaused] = useState(false);
      const dragRef = useRef(null);
      const dragPosRef = useRef(null);

      useEffect(() => {
        const onVisibility = () => setPaused(document.hidden === true);
        document.addEventListener("visibilitychange", onVisibility);
        onVisibility();
        return () => document.removeEventListener("visibilitychange", onVisibility);
      }, []);

      useEffect(() => {
        if (audioEngine) audioEngine.setMuted(snapshot.muted);
      }, [snapshot.muted]);

      useEffect(() => {
        if (!snapshot.visible && audioEngine) audioEngine.stop();
      }, [snapshot.visible]);

      useEffect(() => {
        return () => {
          if (audioEngine) {
            audioEngine.dispose();
            audioEngine = null;
          }
        };
      }, []);

      const state = snapshot.state;
      const label = LABELS[state] || LABELS.work;

      function playStateSound(next) {
        const engine = getAudioEngine();
        engine.setMuted(store.get().muted);
        engine.play(next, store.get().muted);
      }

      function cycle() {
        const next = nextState(store.get().state);
        store.set({ state: next });
        playStateSound(next);
        setBump((value) => value + 1);
      }

      function onPointerDown(event) {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        const current = store.get();
        const start = layout(current, viewport.w, viewport.h);
        dragRef.current = {
          id: event.pointerId,
          sx: event.clientX,
          sy: event.clientY,
          left: start.left,
          top: start.top,
          maxX: start.maxX,
          maxY: start.maxY,
          moved: false,
        };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch (error) {
          /* 旧浏览器忽略 */
        }
      }

      function onPointerMove(event) {
        const info = dragRef.current;
        if (!info || info.id !== event.pointerId) return;
        const dx = event.clientX - info.sx;
        const dy = event.clientY - info.sy;
        if (!info.moved) {
          if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
          info.moved = true;
        }
        const left = Math.min(
          MARGIN + info.maxX,
          Math.max(MARGIN, info.left + dx)
        );
        const top = Math.min(
          MARGIN + info.maxY,
          Math.max(MARGIN, info.top + dy)
        );
        const next = {
          xPct: info.maxX > 0 ? (left - MARGIN) / info.maxX : 1,
          yPct: info.maxY > 0 ? (top - MARGIN) / info.maxY : 1,
        };
        dragPosRef.current = next;
        setDrag(next);
      }

      function endDrag(event) {
        const info = dragRef.current;
        dragRef.current = null;
        if (!info) return;
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch (error) {
          /* 忽略 */
        }
        if (info.moved) {
          const pos = dragPosRef.current;
          if (pos) store.set({ xPct: pos.xPct, yPct: pos.yPct });
          setDrag(null);
          dragPosRef.current = null;
        } else {
          cycle();
        }
      }

      function onPointerCancel() {
        dragRef.current = null;
        dragPosRef.current = null;
        setDrag(null);
      }

      function onKeyDown(event) {
        if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
          event.preventDefault();
          cycle();
        }
      }

      if (!snapshot.visible) return null;

      const pct = drag || { xPct: snapshot.xPct, yPct: snapshot.yPct };
      const pos = layout(pct, viewport.w, viewport.h);

      const burst =
        bump > 0
          ? h(
              "div",
              { className: "kc-burst", "aria-hidden": "true" },
              Array.from({ length: 7 }, (_, index) =>
                h("i", {
                  key: index,
                  style: {
                    "--a": String(index * 51 + 12) + "deg",
                    "--d": String(22 + (index % 3) * 9) + "px",
                    animationDelay: String(index * 12) + "ms",
                  },
                })
              )
            )
          : null;

      return h(
        "div",
        {
          className: "kc-pet" + (paused ? " kc-paused" : ""),
          "data-state": state,
          style: { left: pos.left + "px", top: pos.top + "px" },
        },
        h(
          "div",
          { className: "kc-top" },
          h(
            "span",
            { className: "kc-bubble", title: HINTS[state] || "" },
            h("span", { className: "kc-dot", "aria-hidden": "true" }),
            h(
              "span",
              { className: "kc-label", "aria-live": "polite" },
              label
            )
          )
        ),
        h(
          "div",
          {
            className: "kc-stage",
            role: "button",
            tabIndex: 0,
            "aria-label": "克莱恩猫：" + label + "，点击切换状态",
            title: "点击切换：努力工作中 → 累了 → 休息中",
            style: { touchAction: "none" },
            onPointerDown: onPointerDown,
            onPointerMove: onPointerMove,
            onPointerUp: endDrag,
            onPointerCancel: onPointerCancel,
            onKeyDown: onKeyDown,
          },
          h(
            "div",
            { className: "kc-scene", key: "scene-" + bump },
            h("svg", {
              key: state,
              viewBox: "0 0 160 180",
              className: "kc-svg",
              "aria-hidden": "true",
              focusable: "false",
              dangerouslySetInnerHTML: { __html: ART[state] || ART.work },
            }),
            burst,
            bump > 0
              ? h("div", {
                  className: "kc-fog",
                  "aria-hidden": "true",
                })
              : null
          )
        ),
        h(
          "div",
          { className: "kc-tools", onPointerDown: (e) => e.stopPropagation() },
          h(
            "button",
            {
              type: "button",
              className: "kc-tool",
              title: snapshot.muted ? "取消静音" : "静音",
              "aria-label": snapshot.muted ? "取消静音" : "静音",
              onClick: () => store.set({ muted: !snapshot.muted }),
              dangerouslySetInnerHTML: {
                __html: snapshot.muted ? ICON_MUTE : ICON_UNMUTE,
              },
            }
          ),
          h(
            "button",
            {
              type: "button",
              className: "kc-tool",
              title: "复位位置",
              "aria-label": "复位位置",
              onClick: () => store.set({ xPct: 1, yPct: 1 }),
              dangerouslySetInnerHTML: { __html: ICON_RESET },
            }
          ),
          h(
            "button",
            {
              type: "button",
              className: "kc-tool",
              title: "隐藏宠物",
              "aria-label": "隐藏宠物",
              onClick: () => store.set({ visible: false }),
              dangerouslySetInnerHTML: { __html: ICON_HIDE },
            }
          )
        )
      );
    }

    function PawButton(props) {
      const store = props.store;
      const snapshot = useStoreValue(store);
      return h(
        "button",
        {
          type: "button",
          className: "kc-paw",
          title: snapshot.visible ? "隐藏克莱恩猫宠物" : "显示克莱恩猫宠物",
          "aria-label": snapshot.visible ? "隐藏克莱恩猫宠物" : "显示克莱恩猫宠物",
          "aria-pressed": snapshot.visible,
          "data-state": snapshot.state,
          "data-hidden": String(!snapshot.visible),
          onClick: () => store.set({ visible: !snapshot.visible }),
        },
        h("span", {
          className: "kc-paw-icon",
          "aria-hidden": "true",
          dangerouslySetInnerHTML: { __html: PAW_ICON },
        }),
        h("span", { className: "kc-paw-state", "aria-hidden": "true" })
      );
    }

    // ─────────────────────────────────────────────────────────────
    // 安装/卸载
    // ─────────────────────────────────────────────────────────────

    function injectStyles() {
      const el = document.createElement("style");
      el.setAttribute("data-plugin", "dsh-klein-cat-pet");
      el.textContent = CSS;
      (document.head || document.documentElement).appendChild(el);
      return () => {
        if (el.parentNode) el.parentNode.removeChild(el);
      };
    }

    const name = "dsh-klein-cat-pet";
    const inject = ["slots"];

    function apply(ctx) {
      try {
        console.info("[klein-cat-pet] client applied");
      } catch (error) {
        /* 忽略 */
      }
      const store = createStore();
      ctx.effect(() => () => store.dispose(), "klein-cat-pet: store");
      ctx.effect(() => injectStyles(), "klein-cat-pet: styles");

      ctx.effect(
        () =>
          ctx.slots.inject("shell.overlay", () =>
            ctx.slots.register(
              {
                name: "shell.overlay",
                id: "klein-cat-pet",
                order: 80,
                label: () => "克莱恩猫",
                inject: () => ({ store }),
              },
              KleinCatPet
            )
          ),
        "klein-cat-pet: overlay"
      );

      ctx.effect(
        () =>
          ctx.slots.inject("sidebar.footer.action", () =>
            ctx.slots.register(
              {
                name: "sidebar.footer.action",
                id: "klein-cat-pet",
                order: 40,
                label: () => "克莱恩猫",
                inject: () => ({ store }),
              },
              PawButton
            )
          ),
        "klein-cat-pet: paw"
      );
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    exports.__test = {
      STATES,
      LABELS,
      DEFAULT_STATE,
      nextState,
      normalize,
      layout,
      clamp01,
      STORAGE_KEY,
      PET_W,
      PET_H,
      MARGIN,
      CSS,
      ART,
      createStore,
      KleinCatPet,
      PawButton,
    };
    return module.exports;
  },
});
