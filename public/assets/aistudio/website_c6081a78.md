website:  
<!DOCTYPE html>

<html class="dark" lang="en"><head>

<meta charset="utf-8"/>

<meta content="width=device-width, initial-scale=1.0" name="viewport"/>

<title>Lingonberry Router — Sub-millisecond Local IPC Daemon</title>

<link href="[https://fonts.googleapis.com](https://fonts.googleapis.com)" rel="preconnect"/>

<link crossorigin="" href="[https://fonts.gstatic.com](https://fonts.gstatic.com)" rel="preconnect"/>

<link href="[https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&amp;family=JetBrains+Mono:wght@400;500;600&amp;display=swap](https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&amp;family=JetBrains+Mono:wght@400;500;600&amp;display=swap)" rel="stylesheet"/>

<link href="[https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap](https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap)" rel="stylesheet"/>

<script src="[https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>](https://cdn.tailwindcss.com?plugins=forms,container-queries"\>\</script\>)

<script id="tailwind-config">

tailwind.config = {

darkMode: "class",

theme: {

extend: {

colors: {

background: "#090a0d",

surface: "#0e1017",

"surface-dim": "#090a0d",

"surface-container-lowest": "#06070a",

"surface-container-low": "#11131b",

"surface-container": "#151821",

"surface-container-high": "#1c1f2b",

"surface-container-highest": "#252938",

"surface-bright": "#323749",

primary: "#fabb60",

"primary-container": "#e5a950",

"on-primary": "#291800",

"on-primary-container": "#613f00",

"primary-champagne": "#f7d59b",

secondary: "#adc6ff",

"secondary-container": "#0566d9",

tertiary: "#59e8ab",

"tertiary-container": "#10b981",

"on-surface": "#f1f2f6",

"on-surface-variant": "#9ba1b4",

outline: "#34394a",

"outline-variant": "rgba(255,255,255,0.08)"

},

fontFamily: {

sans: \["Geist", "-apple-system", "BlinkMacSystemFont", "sans-serif"\],

mono: \["JetBrains Mono", "monospace"\]

},

boxShadow: {

'glow-champagne': '0 0 35px -5px rgba(229, 169, 80, 0.22), 0 0 15px -3px rgba(229, 169, 80, 0.12)',

'glow-emerald': '0 0 25px -4px rgba(16, 185, 129, 0.35)',

'titanium-card': 'inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 20px 40px -15px rgba(0, 0, 0, 0.7)',

'floating-nav': '0 20px 45px -10px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.12)'

}

}

}

};

</script>

<style>

body {

background-color: #090a0d;

color: #f1f2f6;

font-family: 'Geist', sans-serif;

overscroll-behavior: none;

\-webkit-font-smoothing: antialiased;

}

::-webkit-scrollbar { display: none; }

.gradient-radial-spotlight {

background: radial-gradient(circle at 50% 0%, rgba(229, 169, 80, 0.14) 0%, rgba(16, 185, 129, 0.03) 40%, rgba(9, 10, 13, 0) 75%);

}

.glass-pill {

background: rgba(17, 19, 27, 0.72);

backdrop-filter: blur(20px);

\-webkit-backdrop-filter: blur(20px);

border: 1px solid rgba(255, 255, 255, 0.08);

}

.glass-card {

background: linear-gradient(180deg, rgba(21, 24, 33, 0.85) 0%, rgba(14, 16, 23, 0.95) 100%);

border: 1px solid rgba(255, 255, 255, 0.07);

box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 14px 30px -10px rgba(0, 0, 0, 0.6);

}

.pulse-dot-amber {

box-shadow: 0 0 10px rgba(229, 169, 80, 0.8);

}

.pulse-dot-green {

box-shadow: 0 0 10px rgba(16, 185, 129, 0.9);

}

/\* Modal Backdrop Blur \*/

.modal-backdrop {

background: rgba(4, 5, 8, 0.78);

backdrop-filter: blur(16px);

\-webkit-backdrop-filter: blur(16px);

}

</style>

</head>

<body class="selection:bg-primary/20 selection:text-primary relative min-h-screen pb-12">

<!-- Ambient Luxury Spotlights -->

<div class="fixed inset-0 pointer-events-none z-0 overflow-hidden">

<div class="absolute top-0 left-1/2 -translate-x-1/2 w-\[1100px\] h-\[550px\] gradient-radial-spotlight"></div>

<div class="absolute top-\[380px\] right-\[10%\] w-\[420px\] h-\[420px\] bg-tertiary-container/5 rounded-full blur-\[140px\]"></div>

<div class="absolute top-\[800px\] left-\[5%\] w-\[500px\] h-\[500px\] bg-primary/5 rounded-full blur-\[150px\]"></div>

</div>

<!-- FLOATING PILL TOP NAVIGATION (TE / LINEAR / RAYCAST STYLE) -->

<header class="sticky top-4 z-50 px-4 w-full flex justify-center">

<nav class="glass-pill shadow-floating-nav rounded-full px-4 py-2 flex items-center justify-between gap-6 md:gap-8 max-w-5xl w-full mx-auto transition-all">

<!-- Brand & Version -->

<a class="flex items-center gap-2.5 group shrink-0" href="#">

<div class="w-5 h-5 rounded-md bg-gradient-to-br from-primary to-amber-600 flex items-center justify-center shadow-glow-champagne p-0.5">

<div class="w-2.5 h-2.5 rounded-full bg-background flex items-center justify-center">

<span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>

</div>

</div>

<div class="flex items-baseline gap-1.5">

<span class="text-\[13px\] font-semibold tracking-tight text-white group-hover:text-primary transition-colors">Lingonberry</span>

<span class="text-\[10px\] font-mono text-on-surface-variant font-medium px-1.5 py-0.5 rounded bg-white/\[0.04\] border border-white/\[0.06\]">v0.9.4</span>

</div>

</a>

<!-- Navigation Links -->

<div class="hidden md:flex items-center gap-6 text-\[12px\] text-on-surface-variant font-medium">

<a class="text-white hover:text-primary transition-colors" href="#overview">Overview</a>

<a class="hover:text-white transition-colors" href="#architecture" onclick="openArchModal(); return false;">Architecture</a>

<a class="hover:text-white transition-colors" href="#telemetry" onclick="openTelemetryModal(); return false;">Telemetry</a>

<a class="hover:text-white transition-colors" href="#matrix">Releases</a>

<a class="hover:text-white transition-colors" href="[https://github.com](https://github.com)" rel="noreferrer" target="\_blank">Docs</a>

</div>

<!-- Action Items & Status Pill -->

<div class="flex items-center gap-2.5 shrink-0">

<!-- Live Status Capsule -->

<button class="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/\[0.08\] border border-emerald-500/20 text-emerald-400 text-\[11px\] font-mono hover:bg-emerald-500/\[0.14\] transition-all cursor-pointer" onclick="openTelemetryModal()" title="Inspect Daemon Telemetry">

<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>

<span>daemon: 0.2ms</span>

</button>

<!-- Command Palette Trigger (Cmd+K) -->

<button class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/\[0.05\] border border-white/\[0.08\] hover:border-white/20 hover:bg-white/\[0.09\] text-on-surface-variant hover:text-white text-\[11px\] font-mono transition-all" onclick="openTelemetryModal()" title="Open Quick Command &amp; Telemetry">

<span class="material-symbols-outlined text-\[14px\]">terminal</span>

<span class="hidden sm:inline">⌘K</span>

</button>

<!-- GitHub Pill -->

<a class="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/\[0.06\] hover:bg-white/\[0.12\] border border-white/\[0.08\] text-white text-\[11px\] font-medium transition-all group" href="[https://github.com](https://github.com)" rel="noreferrer" target="\_blank">

<span class="text-primary text-\[11px\] group-hover:scale-110 transition-transform">★</span>

<span class="font-mono text-\[11px\]">4.2k</span>

</a>

</div>

</nav>

</header>

<main class="relative z-10 max-w-5xl mx-auto px-4 md:px-6 pt-10 md:pt-14 flex flex-col gap-16">

<!-- HERO SECTION: TITANIUM / LUXURY MINIMALISM -->

<section class="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center" id="overview">

<!-- Left Column: Confident Pitch & Direct Hardware Ergonomics -->

<div class="lg:col-span-5 flex flex-col gap-5 text-left">

<!-- Live Micro Status Badges -->

<div class="flex items-center gap-2 flex-wrap">

<div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/\[0.08\] border border-amber-500/20 text-primary font-mono text-\[11px\]">

<span class="w-1.5 h-1.5 rounded-full bg-primary pulse-dot-amber"></span>

<span>Zero-Cloud IPC Daemon</span>

</div>

<span class="text-\[11px\] font-mono text-on-surface-variant px-2 py-0.5 rounded bg-white/\[0.03\] border border-white/\[0.06\]">

Apache-2.0

</span>

</div>

<!-- Headline -->

<h1 class="text-3xl sm:text-4xl lg:text-\[40px\] font-semibold tracking-\[-0.035em\] text-white leading-\[1.12\]">

The sub-millisecond IPC router for local agent runtimes.

</h1>

<!-- Subtitle -->

<p class="text-\[14px\] text-on-surface-variant leading-relaxed max-w-md font-normal">

Lingonberry routes raw token streams between terminal scripts, background cron workers, and inference engines via zero-copy Unix domain sockets.

</p>

<!-- Command Line Copy Box -->

<div class="glass-card rounded-xl p-1.5 flex items-center justify-between gap-2 border border-white/\[0.08\] shadow-inner group">

<div class="flex items-center gap-2 pl-3 font-mono text-\[12px\] text-zinc-300 truncate">

<span class="text-primary/70 select-none font-bold">$</span>

<span class="truncate font-medium text-zinc-200" id="heroCliSnippet">brew install lingonberry-router</span>

</div>

<button class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/\[0.06\] hover:bg-white/\[0.12\] text-white text-\[11px\] font-mono transition-all border border-white/\[0.05\]" id="heroCopyBtn" onclick="copySnippet('heroCliSnippet', 'heroCopyBtn')">

<span class="material-symbols-outlined text-\[13px\]">content\_copy</span>

<span>Copy</span>

</button>

</div>

<!-- Primary CTA Buttons -->

<div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-1">

<button class="relative group overflow-hidden rounded-xl p-px font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 shadow-glow-champagne transition-all transform active:scale-\[0.98\]" onclick="openDownloadModal('macos')">

<span class="absolute inset-0 bg-gradient-to-r from-amber-400 via-primary to-amber-600 rounded-xl"></span>

<span class="relative flex items-center justify-center gap-2 px-5 py-2.5 rounded-\[11px\] bg-gradient-to-b from-\[#1b1915\] to-\[#11100e\] text-amber-200 font-semibold text-\[13px\] border border-amber-300/30 group-hover:border-amber-300/60 transition-all">

<span class="material-symbols-outlined text-\[16px\] text-amber-400">download</span>

<span>Download v0.9.4</span>

</span>

</button>

<button class="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/\[0.04\] hover:bg-white/\[0.08\] border border-white/\[0.08\] text-white text-\[13px\] font-medium transition-all" onclick="openTelemetryModal()">

<span class="material-symbols-outlined text-\[16px\] text-primary">ssid\_chart</span>

<span>Live Telemetry</span>

</button>

<button class="flex items-center justify-center gap-1 px-3 py-2.5 rounded-xl text-on-surface-variant hover:text-white text-\[12px\] font-mono transition-colors" onclick="openArchModal()">

<span>Spec</span>

<span class="material-symbols-outlined text-\[14px\]">arrow\_outward</span>

</button>

</div>

<!-- Micro Feature Tickers -->

<div class="flex items-center gap-4 text-\[11px\] font-mono text-zinc-400 pt-1">

<span class="flex items-center gap-1">

<span class="text-emerald-400">✓</span> Metal 3 Accelerated

</span>

<span class="text-zinc-600">·</span>

<span class="flex items-center gap-1">

<span class="text-emerald-400">✓</span> 18MB Idle RAM

</span>

<span class="text-zinc-600">·</span>

<span class="flex items-center gap-1">

<span class="text-emerald-400">✓</span> eBPF Isolated

</span>

</div>

</div>

<!-- Right Column: Precision Titanium Hardware & Orchestration HUD -->

<div class="lg:col-span-7 flex flex-col items-center">

<div class="w-full max-w-\[510px\] rounded-2xl glass-card border border-white/\[0.1\] shadow-titanium-card p-4 relative overflow-hidden backdrop-blur-2xl">

<!-- Subtle top bezel light strip -->

<div class="absolute top-0 left-1/4 right-1/4 h-\[1px\] bg-gradient-to-r from-transparent via-primary/50 to-transparent"></div>

<!-- Native macOS Header Strip -->

<div class="flex items-center justify-between pb-3 mb-3 border-b border-white/\[0.06\]">

<div class="flex items-center gap-2">

<div class="flex items-center gap-1.5">

<span class="w-2.5 h-2.5 rounded-full bg-\[#ff5f56\]/80 border border-\[#ff5f56\]"></span>

<span class="w-2.5 h-2.5 rounded-full bg-\[#ffbd2e\]/80 border border-\[#ffbd2e\]"></span>

<span class="w-2.5 h-2.5 rounded-full bg-\[#27c93f\]/80 border border-\[#27c93f\]"></span>

</div>

<span class="font-mono text-\[11px\] font-medium text-zinc-300 ml-2">lingonberryd</span>

<span class="text-\[9px\] font-mono px-1.5 py-0.5 rounded bg-white/\[0.05\] text-on-surface-variant">IPC Sockets: /tmp/lingonberry.sock</span>

</div>

<div class="flex items-center gap-2">

<span class="flex items-center gap-1 text-\[10px\] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">

<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>

ACTIVE

</span>

</div>

</div>

<!-- Dynamic SVG Routing HUD -->

<div class="bg-surface-container-lowest/80 rounded-xl p-3 border border-white/\[0.05\] relative flex flex-col">

<div class="flex items-center justify-between mb-2 px-1">

<span class="text-\[11px\] font-mono text-zinc-400 flex items-center gap-1.5">

<span class="material-symbols-outlined text-\[13px\] text-primary">hub</span>

Live Shared-Memory Mesh

</span>

<span class="text-\[10px\] font-mono text-zinc-500">Click callers to pulse</span>

</div>

<!-- Visual Flow Canvas -->

<div class="relative w-full h-\[188px\] bg-black/40 rounded-lg overflow-hidden flex items-center justify-between px-3 py-2 border border-white/\[0.03\]">

<!-- SVG Routing Cable Layer -->

<svg class="absolute inset-0 w-full h-full pointer-events-none z-0" id="routeSvg" preserveaspectratio="none" viewbox="0 0 460 188">

<!-- Background Wires -->

<path d="M 120 34 C 185 34, 185 94, 230 94" fill="none" stroke="rgba(255,255,255,0.07)" stroke-dasharray="2 3" stroke-width="1.2"></path>

<path d="M 120 94 C 185 94, 185 94, 230 94" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="1.2"></path>

<path d="M 120 154 C 185 154, 185 94, 230 94" fill="none" stroke="rgba(255,255,255,0.07)" stroke-dasharray="2 3" stroke-width="1.2"></path>

<path d="M 230 94 C 275 94, 275 34, 340 34" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="1.2"></path>

<path d="M 230 94 C 275 94, 275 94, 340 94" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="1.2"></path>

<path d="M 230 94 C 275 94, 275 154, 340 154" fill="none" stroke="rgba(255,255,255,0.07)" stroke-dasharray="2 3" stroke-width="1.2"></path>

<!-- Active Pulsing Fiber Cable (Animated) -->

<path class="opacity-0 transition-opacity duration-300" d="M 120 34 C 185 34, 185 94, 230 94 C 275 94, 275 34, 340 34" fill="none" filter="drop-shadow(0 0 6px #fabb60)" id="activePulseCable" stroke="#fabb60" stroke-linecap="round" stroke-width="2"></path>

</svg>

<!-- Left: Callers Column -->

<div class="z-10 flex flex-col gap-2 w-\[110px\]">

<button class="caller-node text-left px-2 py-1.5 rounded-lg bg-surface-container/90 hover:bg-surface-container-high border border-white/\[0.08\] transition-all group hover:border-primary/40" onclick="triggerStreamRoute('[client.py](http://client.py)', 'llama-3-8b', 34, 34, '0.18ms')">

<div class="flex items-center justify-between">

<span class="font-mono text-\[10px\] font-semibold text-zinc-200 group-hover:text-primary">[client.py](http://client.py)</span>

<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>

</div>

<span class="text-\[9px\] font-mono text-zinc-400 block mt-0.5">stream · 1.4k t/s</span>

</button>

<button class="caller-node text-left px-2 py-1.5 rounded-lg bg-surface-container/90 hover:bg-surface-container-high border border-white/\[0.08\] transition-all group hover:border-primary/40" onclick="triggerStreamRoute('web\_agent', 'deepseek-r1', 94, 94, '0.34ms')">

<div class="flex items-center justify-between">

<span class="font-mono text-\[10px\] font-semibold text-zinc-200 group-hover:text-primary">web\_agent</span>

<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>

</div>

<span class="text-\[9px\] font-mono text-zinc-400 block mt-0.5">async · ring\_buffer</span>

</button>

<button class="caller-node text-left px-2 py-1.5 rounded-lg bg-surface-container/90 hover:bg-surface-container-high border border-white/\[0.08\] transition-all group hover:border-primary/40" onclick="triggerStreamRoute('local\_eval', 'gemini-flash', 154, 154, '0.12ms')">

<div class="flex items-center justify-between">

<span class="font-mono text-\[10px\] font-semibold text-zinc-200 group-hover:text-primary">local\_eval</span>

<span class="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>

</div>

<span class="text-\[9px\] font-mono text-zinc-400 block mt-0.5">bench · loop</span>

</button>

</div>

<!-- Center: Core Routing Matrix Node -->

<div class="z-10 flex flex-col items-center justify-center">

<div class="w-14 h-14 rounded-2xl bg-surface-container-high/90 border border-primary/30 flex flex-col items-center justify-center shadow-lg transition-transform duration-300 relative group cursor-pointer" id="hubCore" onclick="simulateBurst()">

<div class="absolute inset-0 rounded-2xl bg-primary/10 blur-md pointer-events-none"></div>

<span class="material-symbols-outlined text-\[20px\] text-primary">route</span>

<span class="font-mono text-\[8px\] font-bold tracking-wider text-amber-200 mt-0.5">DISPATCH</span>

</div>

<div class="mt-1.5 px-2 py-0.5 rounded-full bg-white/\[0.04\] border border-white/\[0.06\] flex items-center gap-1">

<span class="w-1 h-1 rounded-full bg-primary animate-ping"></span>

<span class="font-mono text-\[9px\] text-zinc-300" id="liveRpsCount">128 rps</span>

</div>

</div>

<!-- Right: Inference Worker Targets -->

<div class="z-10 flex flex-col gap-2 w-\[114px\]">

<div class="text-left px-2 py-1.5 rounded-lg bg-surface-container/90 border border-white/\[0.06\]">

<div class="flex items-center justify-between">

<span class="font-mono text-\[10px\] font-semibold text-zinc-200">llama-3-8b</span>

<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>

</div>

<span class="text-\[9px\] font-mono text-zinc-400 block mt-0.5">Metal · 2.1% CPU</span>

</div>

<div class="text-left px-2 py-1.5 rounded-lg bg-surface-container/90 border border-white/\[0.06\]">

<div class="flex items-center justify-between">

<span class="font-mono text-\[10px\] font-semibold text-zinc-200">deepseek-r1</span>

<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>

</div>

<span class="text-\[9px\] font-mono text-zinc-400 block mt-0.5">mmap · 84MB RSS</span>

</div>

<div class="text-left px-2 py-1.5 rounded-lg bg-surface-container/90 border border-white/\[0.06\]">

<div class="flex items-center justify-between">

<span class="font-mono text-\[10px\] font-semibold text-zinc-200">gemini-flash</span>

<span class="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>

</div>

<span class="text-\[9px\] font-mono text-zinc-400 block mt-0.5">fall-through proxy</span>

</div>

</div>

</div>

<!-- HUD Tactile Controls -->

<div class="flex items-center gap-2 mt-2 pt-2 border-t border-white/\[0.04\]">

<button class="flex-1 py-1.5 px-2 rounded-lg bg-white/\[0.04\] hover:bg-white/\[0.08\] text-white font-mono text-\[10px\] flex items-center justify-center gap-1.5 transition-all border border-white/\[0.06\]" onclick="simulateBurst()">

<span class="material-symbols-outlined text-\[13px\] text-primary">bolt</span>

<span>Simulate Burst</span>

</button>

<button class="py-1.5 px-2.5 rounded-lg bg-white/\[0.04\] hover:bg-white/\[0.08\] text-on-surface-variant hover:text-white font-mono text-\[10px\] flex items-center gap-1 transition-all border border-white/\[0.06\]" onclick="openArchModal()">

<span class="material-symbols-outlined text-\[13px\]">filter\_alt</span>

<span>Inspect Gate</span>

</button>

<button class="py-1.5 px-2.5 rounded-lg bg-white/\[0.04\] hover:bg-white/\[0.08\] text-on-surface-variant font-mono text-\[10px\] flex items-center gap-1 transition-all border border-white/\[0.06\]" id="standbyBtn" onclick="toggleStandbyMode()">

<span class="material-symbols-outlined text-\[13px\]">bedtime</span>

<span id="standbyLabel">VRAM Standby: ON</span>

</button>

</div>

</div>

<!-- Micro Hardware Log Stream -->

<div class="mt-2.5 p-2 rounded-xl bg-surface-container-lowest/90 border border-white/\[0.04\] font-mono text-\[10px\]">

<div class="flex items-center justify-between text-zinc-400 mb-1">

<span class="flex items-center gap-1.5">

<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>

<span>unix socket ring-0 trace</span>

</span>

<span class="text-zinc-500" id="traceClock">14:48:02.19</span>

</div>

<div class="flex flex-col gap-1 text-zinc-300" id="traceLogContainer">

<div class="truncate text-zinc-400">\[14:48:01\] IPC SHM\_OPEN /lingonberry\_shm\_482 (0.04ms)</div>

<div class="truncate text-zinc-200">\[14:48:02\] ROUTE [client.py](http://client.py) → llama-3-8b (0.18ms · zero copy)</div>

</div>

</div>

</div>

</div>

</section>

<!-- ARCHITECTURE SPEC SECTION: CRAFTED BENTO GRID -->

<section class="flex flex-col gap-6 pt-6" id="architecture">

<div class="flex flex-col md:flex-row md:items-end justify-between gap-4">

<div>

<div class="inline-flex items-center gap-1.5 text-primary text-\[11px\] font-mono uppercase tracking-wider mb-1 font-semibold">

<span class="w-1 h-1 rounded-full bg-primary"></span>

Engineering Specification

</div>

<h2 class="text-2xl font-semibold text-white tracking-tight">Engineered for millisecond concurrency</h2>

<p class="text-zinc-400 text-\[13px\] mt-1 max-w-xl">

Operating as a headless daemon with native IPC primitives. No Electron, no Python runtime overhead, and no mandatory cloud dependencies.

</p>

</div>

<button class="self-start md:self-end flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/\[0.04\] hover:bg-white/\[0.08\] border border-white/\[0.08\] text-zinc-300 hover:text-white text-\[12px\] font-mono transition-all" onclick="openArchModal()">

<span>Read Full Deep-Dive</span>

<span class="material-symbols-outlined text-\[14px\]">arrow\_forward</span>

</button>

</div>

<!-- Bento Cards -->

<div class="grid grid-cols-1 md:grid-cols-3 gap-4">

<!-- Card 1 -->

<div class="glass-card rounded-2xl p-5 flex flex-col justify-between border border-white/\[0.07\] hover:border-white/\[0.15\] transition-all group">

<div>

<div class="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-primary mb-4 group-hover:scale-105 transition-transform">

<span class="material-symbols-outlined text-\[18px\]">bolt</span>

</div>

<h3 class="text-white font-medium text-\[15px\] tracking-tight">Zero-Copy Unix Sockets</h3>

<p class="text-zinc-400 text-\[13px\] leading-relaxed mt-2">

Passes serialized LLM memory slices directly via POSIX shared memory buffers `shm_open`) with under 0.2ms latency across concurrent processes.

</p>

</div>

<div class="mt-6 pt-3 border-t border-white/\[0.06\] flex items-center justify-between text-\[11px\] font-mono">

<span class="text-zinc-400">Latency: &lt; 0.24ms</span>

<span class="text-emerald-400 font-medium">zero HTTP hop</span>

</div>

</div>

<!-- Card 2 -->

<div class="glass-card rounded-2xl p-5 flex flex-col justify-between border border-white/\[0.07\] hover:border-white/\[0.15\] transition-all group">

<div>

<div class="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-4 group-hover:scale-105 transition-transform">

<span class="material-symbols-outlined text-\[18px\]">memory</span>

</div>

<h3 class="text-white font-medium text-\[15px\] tracking-tight">Intelligent VRAM Throttler</h3>

<p class="text-zinc-400 text-\[13px\] leading-relaxed mt-2">

Schedules memory eviction automatically. When battery charge drops or Xcode/Rust compile jobs start, model weights gracefully unload to disk caches.

</p>

</div>

<div class="mt-6 pt-3 border-t border-white/\[0.06\] flex items-center justify-between text-\[11px\] font-mono">

<span class="text-zinc-400">Footprint: 18MB idle</span>

<span class="text-primary font-medium">battery-aware</span>

</div>

</div>

<!-- Card 3 -->

<div class="glass-card rounded-2xl p-5 flex flex-col justify-between border border-white/\[0.07\] hover:border-white/\[0.15\] transition-all group">

<div>

<div class="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mb-4 group-hover:scale-105 transition-transform">

<span class="material-symbols-outlined text-\[18px\]">verified\_user</span>

</div>

<h3 class="text-white font-medium text-\[15px\] tracking-tight">Air-Gapped Local Ring</h3>

<p class="text-zinc-400 text-\[13px\] leading-relaxed mt-2">

Deterministic sandbox rules guarantee internal prompts stay strictly on-device. No telemetry telemetry data ever egresses beyond local Unix sockets.

</p>

</div>

<div class="mt-6 pt-3 border-t border-white/\[0.06\] flex items-center justify-between text-\[11px\] font-mono">

<span class="text-zinc-400">Ring-3 eBPF sandbox</span>

<span class="text-cyan-400 font-medium">zero egress</span>

</div>

</div>

</div>

</section>

<!-- RELEASE & DISTRIBUTION MATRIX (ELEVATED MAC-STATS STYLE) -->

<section class="flex flex-col gap-5 pt-4" id="matrix">

<div class="flex flex-col md:flex-row md:items-end justify-between gap-4">

<div>

<div class="inline-flex items-center gap-2 mb-1">

<span class="text-primary font-mono text-\[11px\] uppercase tracking-wider font-semibold">Distribution Binaries</span>

<span class="px-2 py-0.5 rounded bg-white/\[0.04\] border border-white/\[0.07\] text-zinc-300 font-mono text-\[10px\]">Production v0.9.4</span>

</div>

<h2 class="text-2xl font-semibold text-white tracking-tight">Multi-Architecture Downloads</h2>

<p class="text-zinc-400 text-\[13px\] mt-1">

Signed with Developer ID, Apple Notarized, and static musl compilation for Linux containers.

</p>

</div>

<!-- Filter Buttons -->

<div class="flex items-center gap-1.5 p-1 rounded-xl bg-white/\[0.03\] border border-white/\[0.07\] self-start md:self-end">

<button class="matrix-filter-btn px-3 py-1 rounded-lg bg-white/\[0.1\] text-white text-\[11px\] font-mono font-medium transition-all" id="btn-filter-all" onclick="filterMatrix('all')">All</button>

<button class="matrix-filter-btn px-3 py-1 rounded-lg text-zinc-400 hover:text-white text-\[11px\] font-mono transition-all" id="btn-filter-macos" onclick="filterMatrix('macos')">macOS</button>

<button class="matrix-filter-btn px-3 py-1 rounded-lg text-zinc-400 hover:text-white text-\[11px\] font-mono transition-all" id="btn-filter-linux" onclick="filterMatrix('linux')">Linux</button>

<button class="matrix-filter-btn px-3 py-1 rounded-lg text-zinc-400 hover:text-white text-\[11px\] font-mono transition-all" id="btn-filter-windows" onclick="filterMatrix('windows')">Windows</button>

</div>

</div>

<!-- Release Matrix Table Card -->

<div class="glass-card rounded-2xl overflow-hidden border border-white/\[0.08\] shadow-titanium-card">

<div class="overflow-x-auto">

<table class="w-full text-left border-collapse">

<thead>

<tr class="bg-surface-container-lowest/90 border-b border-white/\[0.06\] text-zinc-400 font-mono text-\[10px\] uppercase tracking-wider">

<th class="py-3 px-4 font-semibold">Platform &amp; Target</th>

<th class="py-3 px-4 font-semibold">Arch</th>

<th class="py-3 px-4 font-semibold">Package Format</th>

<th class="py-3 px-4 font-semibold">Size</th>

<th class="py-3 px-4 font-semibold">SHA-256 Checksum</th>

<th class="py-3 px-4 font-semibold text-right">Download</th>

</tr>

</thead>

<tbody class="divide-y divide-white/\[0.04\] text-\[12px\]">

<!-- macOS Apple Silicon -->

<tr class="matrix-row group hover:bg-white/\[0.02\] transition-colors" data-platform="macos">

<td class="py-3.5 px-4">

<div class="flex items-center gap-2.5">

<span class="w-2 h-2 rounded-full bg-primary pulse-dot-amber"></span>

<div>

<div class="font-medium text-white group-hover:text-primary transition-colors">macOS Apple Silicon</div>

<div class="text-\[10px\] font-mono text-zinc-400">Ventura 13.0+ · Metal 3 accelerated (M1–M4)</div>

</div>

</div>

</td>

<td class="py-3.5 px-4 font-mono text-zinc-300">arm64</td>

<td class="py-3.5 px-4 font-mono text-zinc-400">Universal .dmg / .tar.gz</td>

<td class="py-3.5 px-4 font-mono text-zinc-400">14.2 MB</td>

<td class="py-3.5 px-4 font-mono text-zinc-400">

<button class="px-2 py-0.5 rounded bg-white/\[0.04\] hover:bg-white/\[0.1\] text-zinc-300 hover:text-white transition-all text-\[11px\] flex items-center gap-1 group/hash" onclick="copyHash('8a21fec998394e339b1a0d8bf7612c7d1e1fa42981ceefd12384a20b9e8310c4')">

<span>8a21fec...10c4</span>

<span class="material-symbols-outlined text-\[11px\] text-zinc-500 group-hover/hash:text-primary">content\_copy</span>

</button>

</td>

<td class="py-3.5 px-4 text-right">

<button class="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-white/\[0.06\] hover:bg-primary hover:text-background text-zinc-200 font-mono text-\[11px\] font-medium transition-all border border-white/\[0.08\]" onclick="openDownloadModal('macos')">

<span class="material-symbols-outlined text-\[13px\]">download</span>

<span>.dmg</span>

</button>

</td>

</tr>

<!-- macOS Intel -->

<tr class="matrix-row group hover:bg-white/\[0.02\] transition-colors" data-platform="macos">

<td class="py-3.5 px-4">

<div class="flex items-center gap-2.5">

<span class="w-2 h-2 rounded-full bg-zinc-500"></span>

<div>

<div class="font-medium text-white group-hover:text-primary transition-colors">macOS Intel x86</div>

<div class="text-\[10px\] font-mono text-zinc-400">Monterey 12.0 or later</div>

</div>

</div>

</td>

<td class="py-3.5 px-4 font-mono text-zinc-300">x86\_64</td>

<td class="py-3.5 px-4 font-mono text-zinc-400">Standalone .dmg</td>

<td class="py-3.5 px-4 font-mono text-zinc-400">16.8 MB</td>

<td class="py-3.5 px-4 font-mono text-zinc-400">

<button class="px-2 py-0.5 rounded bg-white/\[0.04\] hover:bg-white/\[0.1\] text-zinc-300 hover:text-white transition-all text-\[11px\] flex items-center gap-1 group/hash" onclick="copyHash('9c44ba221e7845f09abdd14389ffea824589d9013cff4e189a022934ecff7881')">

<span>9c44ba2...7881</span>

<span class="material-symbols-outlined text-\[11px\] text-zinc-500 group-hover/hash:text-primary">content\_copy</span>

</button>

</td>

<td class="py-3.5 px-4 text-right">

<button class="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-white/\[0.06\] hover:bg-primary hover:text-background text-zinc-200 font-mono text-\[11px\] font-medium transition-all border border-white/\[0.08\]" onclick="openDownloadModal('macos')">

<span class="material-symbols-outlined text-\[13px\]">download</span>

<span>.dmg</span>

</button>

</td>

</tr>

<!-- Linux Ubuntu/Debian -->

<tr class="matrix-row group hover:bg-white/\[0.02\] transition-colors" data-platform="linux">

<td class="py-3.5 px-4">

<div class="flex items-center gap-2.5">

<span class="w-2 h-2 rounded-full bg-emerald-400"></span>

<div>

<div class="font-medium text-white group-hover:text-primary transition-colors">Ubuntu / Debian systemd</div>

<div class="text-\[10px\] font-mono text-zinc-400">Headless daemon service unit &amp; CLI</div>

</div>

</div>

</td>

<td class="py-3.5 px-4 font-mono text-zinc-300">x86\_64 / arm64</td>

<td class="py-3.5 px-4 font-mono text-zinc-400">.deb package / systemd</td>

<td class="py-3.5 px-4 font-mono text-zinc-400">11.4 MB</td>

<td class="py-3.5 px-4 font-mono text-zinc-400">

<button class="px-2 py-0.5 rounded bg-white/\[0.04\] hover:bg-white/\[0.1\] text-zinc-300 hover:text-white transition-all text-\[11px\] flex items-center gap-1 group/hash" onclick="copyHash('310fb17e754a9d72210ea89bc44129e0019fa7648392100cfb88219488aef01c')">

<span>310fb17...f01c</span>

<span class="material-symbols-outlined text-\[11px\] text-zinc-500 group-hover/hash:text-primary">content\_copy</span>

</button>

</td>

<td class="py-3.5 px-4 text-right">

<button class="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-white/\[0.06\] hover:bg-primary hover:text-background text-zinc-200 font-mono text-\[11px\] font-medium transition-all border border-white/\[0.08\]" onclick="openDownloadModal('linux')">

<span class="material-symbols-outlined text-\[13px\]">download</span>

<span>.deb</span>

</button>

</td>

</tr>

<!-- Linux Arch / Fedora -->

<tr class="matrix-row group hover:bg-white/\[0.02\] transition-colors" data-platform="linux">

<td class="py-3.5 px-4">

<div class="flex items-center gap-2.5">

<span class="w-2 h-2 rounded-full bg-cyan-400"></span>

<div>

<div class="font-medium text-white group-hover:text-primary transition-colors">Arch Linux AUR / Fedora RPM</div>

<div class="text-\[10px\] font-mono text-zinc-400">Static Musl binary (AUR: lingonberry-bin)</div>

</div>

</div>

</td>

<td class="py-3.5 px-4 font-mono text-zinc-300">x86\_64</td>

<td class="py-3.5 px-4 font-mono text-zinc-400">.rpm / PKGBUILD</td>

<td class="py-3.5 px-4 font-mono text-zinc-400">10.9 MB</td>

<td class="py-3.5 px-4 font-mono text-zinc-400">

<button class="px-2 py-0.5 rounded bg-white/\[0.04\] hover:bg-white/\[0.1\] text-zinc-300 hover:text-white transition-all text-\[11px\] flex items-center gap-1 group/hash" onclick="copyHash('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')">

<span>e3b0c44...b855</span>

<span class="material-symbols-outlined text-\[11px\] text-zinc-500 group-hover/hash:text-primary">content\_copy</span>

</button>

</td>

<td class="py-3.5 px-4 text-right">

<button class="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-white/\[0.06\] hover:bg-primary hover:text-background text-zinc-200 font-mono text-\[11px\] font-medium transition-all border border-white/\[0.08\]" onclick="openDownloadModal('linux')">

<span class="material-symbols-outlined text-\[13px\]">download</span>

<span>.rpm</span>

</button>

</td>

</tr>

<!-- Windows 11 / 10 -->

<tr class="matrix-row group hover:bg-white/\[0.02\] transition-colors" data-platform="windows">

<td class="py-3.5 px-4">

<div class="flex items-center gap-2.5">

<span class="w-2 h-2 rounded-full bg-blue-400"></span>

<div>

<div class="font-medium text-white group-hover:text-primary transition-colors">Windows 11 / 10 Tray Daemon</div>

<div class="text-\[10px\] font-mono text-zinc-400">Named Pipes IPC &amp; Taskbar Minimization</div>

</div>

</div>

</td>

<td class="py-3.5 px-4 font-mono text-zinc-300">x64 / arm64</td>

<td class="py-3.5 px-4 font-mono text-zinc-400">.msi installer / Winget</td>

<td class="py-3.5 px-4 font-mono text-zinc-400">15.1 MB</td>

<td class="py-3.5 px-4 font-mono text-zinc-400">

<button class="px-2 py-0.5 rounded bg-white/\[0.04\] hover:bg-white/\[0.1\] text-zinc-300 hover:text-white transition-all text-\[11px\] flex items-center gap-1 group/hash" onclick="copyHash('714cfa882a9381a17fa3910cbe77291a1829e0129bc788210348719bc4a81729')">

<span>714cfa8...1729</span>

<span class="material-symbols-outlined text-\[11px\] text-zinc-500 group-hover/hash:text-primary">content\_copy</span>

</button>

</td>

<td class="py-3.5 px-4 text-right">

<button class="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-white/\[0.06\] hover:bg-primary hover:text-background text-zinc-200 font-mono text-\[11px\] font-medium transition-all border border-white/\[0.08\]" onclick="openDownloadModal('windows')">

<span class="material-symbols-outlined text-\[13px\]">download</span>

<span>.msi</span>

</button>

</td>

</tr>

</tbody>

</table>

</div>

<!-- Verification Signature Footer -->

<div class="bg-surface-container-lowest/90 px-4 py-3 border-t border-white/\[0.06\] flex flex-col sm:flex-row items-center justify-between gap-3 text-zinc-400 font-mono text-\[11px\]">

<div class="flex items-center gap-2">

<span class="material-symbols-outlined text-primary text-\[15px\]">verified</span>

<span>GPG Signer ID: <code class="text-zinc-200">0x7B9A34DE9C104882</code></span>

</div>

<div class="flex items-center gap-4">

<button class="hover:text-white transition-colors flex items-center gap-1" id="gpgCopyBtn" onclick="copySnippet('gpgCmdSnippet', 'gpgCopyBtn')">

<span id="gpgCmdSnippet">curl -sSL lingonberry.run/keys.asc | gpg --import</span>

<span class="material-symbols-outlined text-\[12px\]">content\_copy</span>

</button>

<span class="text-zinc-700">|</span>

<a class="text-primary hover:underline flex items-center gap-0.5" href="#">

<span>Changelog v0.9.4</span>

<span class="material-symbols-outlined text-\[12px\]">north\_east</span>

</a>

</div>

</div>

</div>

</section>

</main>

<!-- LUXURY MINIMAL FOOTER -->

<footer class="mt-20 border-t border-white/\[0.06\] pt-8 max-w-5xl mx-auto px-4">

<div class="flex flex-col md:flex-row items-center justify-between gap-4 text-\[12px\] text-zinc-400">

<div class="flex items-center gap-3">

<div class="flex items-center gap-1.5 font-mono text-\[11px\] text-emerald-400">

<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot-green"></span>

<span>DAEMON NOMINAL</span>

</div>

<span class="text-zinc-700">·</span>

<span class="font-mono text-\[11px\]">Lingonberry Foundation © 2025</span>

</div>

<div class="flex items-center gap-6 font-mono text-\[11px\]">

<button class="hover:text-white transition-colors" onclick="openArchModal()">POSIX Spec</button>

<button class="hover:text-white transition-colors" onclick="openTelemetryModal()">Telemetry Matrix</button>

<a class="hover:text-white transition-colors" href="[https://github.com](https://github.com)" rel="noreferrer" target="\_blank">GitHub Source</a>

<a class="hover:text-white transition-colors" href="#matrix">Releases</a>

</div>

</div>

</footer>

<!-- ======================================================== -->

<!-- MODAL 1: COMMAND & TELEMETRY INSPECTOR (⌘K) -->

<!-- ======================================================== -->

<div class="fixed inset-0 z-50 hidden flex items-center justify-center p-4" id="telemetryModal">

<div class="modal-backdrop absolute inset-0" onclick="closeTelemetryModal()"></div>

<div class="relative w-full max-w-2xl glass-card rounded-2xl border border-white/\[0.12\] shadow-2xl p-5 z-10 animate-in fade-in zoom-in-95 duration-150">

<!-- Modal Header -->

<div class="flex items-center justify-between pb-3 border-b border-white/\[0.07\]">

<div class="flex items-center gap-2">

<span class="material-symbols-outlined text-primary text-\[20px\]">terminal</span>

<h3 class="text-white text-\[14px\] font-semibold tracking-tight">Lingonberry Telemetry &amp; Command Palette</h3>

</div>

<div class="flex items-center gap-2">

<span class="text-\[10px\] font-mono text-zinc-400 bg-white/\[0.04\] px-1.5 py-0.5 rounded border border-white/\[0.06\]">ESC to close</span>

<button class="text-zinc-400 hover:text-white transition-colors" onclick="closeTelemetryModal()">

<span class="material-symbols-outlined text-\[18px\]">close</span>

</button>

</div>

</div>

<!-- Quick Command Input -->

<div class="mt-4 relative">

<span class="absolute left-3 top-2.5 text-primary material-symbols-outlined text-\[16px\]">search</span>

<input class="w-full bg-surface-container-lowest/90 border border-white/\[0.08\] rounded-xl pl-9 pr-4 py-2 text-zinc-200 placeholder-zinc-500 font-mono text-\[12px\] focus:outline-none focus:border-primary/50" placeholder="Type a route command or query (/routes, /ping, /bench)..." type="text"/>

</div>

<!-- Live Benchmarks Grid -->

<div class="grid grid-cols-3 gap-3 my-4">

<div class="bg-surface-container-lowest/80 p-3 rounded-xl border border-white/\[0.05\]">

<span class="text-\[10px\] font-mono text-zinc-400">IPC Round-Trip</span>

<div class="text-\[18px\] font-mono font-semibold text-emerald-400 mt-0.5">0.18 ms</div>

<span class="text-\[9px\] font-mono text-zinc-500">shared-mem unix socket</span>

</div>

<div class="bg-surface-container-lowest/80 p-3 rounded-xl border border-white/\[0.05\]">

<span class="text-\[10px\] font-mono text-zinc-400">Resident VRAM Cache</span>

<div class="text-\[18px\] font-mono font-semibold text-primary mt-0.5">142 MB</div>

<span class="text-\[9px\] font-mono text-zinc-500">metal context active</span>

</div>

<div class="bg-surface-container-lowest/80 p-3 rounded-xl border border-white/\[0.05\]">

<span class="text-\[10px\] font-mono text-zinc-400">Peak Concurrency</span>

<div class="text-\[18px\] font-mono font-semibold text-cyan-400 mt-0.5">384 req/s</div>

<span class="text-\[9px\] font-mono text-zinc-500">zero dropped frames</span>

</div>

</div>

<!-- Live Routes Inspector -->

<div class="border border-white/\[0.06\] rounded-xl overflow-hidden bg-surface-container-lowest/80 mb-4">

<div class="px-3 py-2 bg-white/\[0.02\] border-b border-white/\[0.04\] text-\[11px\] font-mono text-zinc-400 flex justify-between">

<span>Active In-Flight IPC Channels</span>

<span class="text-primary">3 bindings live</span>

</div>

<div class="divide-y divide-white/\[0.03\] font-mono text-\[11px\]">

<div class="p-2.5 flex items-center justify-between text-zinc-300">

<div class="flex items-center gap-2">

<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>

<span class="font-semibold text-white">/tmp/lingonberry.sock</span>

<span class="text-zinc-500">→</span>

<span class="text-primary">llama-3-8b</span>

</div>

<span class="text-\[10px\] text-zinc-400">42KB buffer · 0.16ms</span>

</div>

<div class="p-2.5 flex items-center justify-between text-zinc-300">

<div class="flex items-center gap-2">

<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>

<span class="font-semibold text-white">/dev/shm/lb\_deepseek</span>

<span class="text-zinc-500">→</span>

<span class="text-primary">deepseek-r1</span>

</div>

<span class="text-\[10px\] text-zinc-400">128KB buffer · 0.29ms</span>

</div>

</div>

</div>

<!-- Action Footer -->

<div class="flex items-center justify-between text-\[11px\] font-mono pt-1 text-zinc-400">

<span>Unix Daemon: PID 29014 · running on Metal</span>

<button class="px-3 py-1.5 rounded-lg bg-white/\[0.06\] hover:bg-white/\[0.12\] text-white" onclick="closeTelemetryModal()">Done</button>

</div>

</div>

</div>

<!-- ======================================================== -->

<!-- MODAL 2: ARCHITECTURE SPEC DRAWER / MODAL -->

<!-- ======================================================== -->

<div class="fixed inset-0 z-50 hidden flex items-center justify-center p-4" id="archModal">

<div class="modal-backdrop absolute inset-0" onclick="closeArchModal()"></div>

<div class="relative w-full max-w-2xl glass-card rounded-2xl border border-white/\[0.12\] shadow-2xl p-6 z-10 animate-in fade-in zoom-in-95 duration-150">

<div class="flex items-center justify-between pb-3 border-b border-white/\[0.07\]">

<div class="flex items-center gap-2">

<div class="w-2.5 h-2.5 rounded-full bg-primary pulse-dot-amber"></div>

<h3 class="text-white text-\[15px\] font-semibold tracking-tight">Lingonberry Kernel &amp; IPC Architecture</h3>

</div>

<button class="text-zinc-400 hover:text-white transition-colors" onclick="closeArchModal()">

<span class="material-symbols-outlined text-\[18px\]">close</span>

</button>

</div>

<!-- Tech Deep-Dive Tabs -->

<div class="flex items-center gap-2 my-4 border-b border-white/\[0.06\] pb-2">

<button class="px-3 py-1 rounded-lg bg-white/\[0.08\] text-white text-\[11px\] font-mono font-medium" id="archTab-posix" onclick="switchArchTab('posix')">1. Shared Memory Buffers</button>

<button class="px-3 py-1 rounded-lg text-zinc-400 hover:text-white text-\[11px\] font-mono" id="archTab-ebpf" onclick="switchArchTab('ebpf')">2. eBPF Process Isolation</button>

<button class="px-3 py-1 rounded-lg text-zinc-400 hover:text-white text-\[11px\] font-mono" id="archTab-vram" onclick="switchArchTab('vram')">3. VRAM Standby Policy</button>

</div>

<!-- Tab Content Area -->

<div class="text-\[13px\] text-zinc-300 leading-relaxed font-normal min-h-\[170px\]" id="archContent">

<!-- Rendered by JS -->

</div>

<!-- Drawer Footer -->

<div class="mt-5 pt-3 border-t border-white/\[0.06\] flex items-center justify-between font-mono text-\[11px\]">

<span class="text-zinc-500">RFC Document: LB-2025-09</span>

<button class="px-3 py-1.5 rounded-lg bg-primary text-background font-semibold hover:bg-amber-400 transition-colors" onclick="closeArchModal()">Close Spec</button>

</div>

</div>

</div>

<!-- ======================================================== -->

<!-- MODAL 3: DOWNLOAD & CHECKSUM VERIFIER MODAL -->

<!-- ======================================================== -->

<div class="fixed inset-0 z-50 hidden flex items-center justify-center p-4" id="downloadModal">

<div class="modal-backdrop absolute inset-0" onclick="closeDownloadModal()"></div>

<div class="relative w-full max-w-lg glass-card rounded-2xl border border-white/\[0.12\] shadow-2xl p-6 z-10 animate-in fade-in zoom-in-95 duration-150">

<div class="flex items-center justify-between pb-3 border-b border-white/\[0.07\]">

<div class="flex items-center gap-2">

<span class="material-symbols-outlined text-primary text-\[20px\]">download</span>

<h3 class="text-white text-\[15px\] font-semibold tracking-tight">Download Lingonberry v0.9.4</h3>

</div>

<button class="text-zinc-400 hover:text-white transition-colors" onclick="closeDownloadModal()">

<span class="material-symbols-outlined text-\[18px\]">close</span>

</button>

</div>

<!-- OS Selection Pills -->

<div class="flex items-center gap-1.5 p-1 rounded-xl bg-white/\[0.03\] border border-white/\[0.06\] my-4">

<button class="flex-1 py-1.5 rounded-lg text-center font-mono text-\[11px\] font-semibold bg-white/\[0.1\] text-white" id="mTab-macos" onclick="setModalOs('macos')">macOS</button>

<button class="flex-1 py-1.5 rounded-lg text-center font-mono text-\[11px\] text-zinc-400 hover:text-white" id="mTab-linux" onclick="setModalOs('linux')">Linux</button>

<button class="flex-1 py-1.5 rounded-lg text-center font-mono text-\[11px\] text-zinc-400 hover:text-white" id="mTab-windows" onclick="setModalOs('windows')">Windows</button>

</div>

<!-- Dynamic OS Card Payload -->

<div class="bg-surface-container-lowest/90 p-4 rounded-xl border border-white/\[0.05\] flex flex-col gap-3" id="modalOsDetails">

<!-- Rendered by JS -->

</div>

<div class="mt-4 flex items-center justify-between">

<span class="text-\[10px\] font-mono text-zinc-500">Apple Notarized &amp; GPG Signed</span>

<button class="px-4 py-1.5 rounded-xl bg-white/\[0.06\] hover:bg-white/\[0.12\] text-white font-mono text-\[11px\]" onclick="closeDownloadModal()">Dismiss</button>

</div>

</div>

</div>

<!-- TOAST NOTIFICATION CONTAINER -->

<div class="fixed bottom-6 right-6 z-50 transform translate-y-12 opacity-0 pointer-events-none transition-all duration-200 glass-pill px-4 py-2.5 rounded-xl border border-primary/30 text-white font-mono text-\[11px\] flex items-center gap-2 shadow-2xl" id="toast">

<span class="material-symbols-outlined text-primary text-\[15px\]">check\_circle</span>

<span id="toastMessage">Copied to clipboard</span>

</div>

<!-- JAVASCRIPT LOGIC (SELF-CONTAINED & ZERO DEPENDENCIES) -->

<script>

// Toast notification helper

function showToast(msg) {

const toast = document.getElementById('toast');

const toastMsg = document.getElementById('toastMessage');

toastMsg.textContent = msg;

toast.classList.remove('translate-y-12', 'opacity-0', 'pointer-events-none');

toast.classList.add('translate-y-0', 'opacity-100');

setTimeout(() => {

toast.classList.add('translate-y-12', 'opacity-0', 'pointer-events-none');

toast.classList.remove('translate-y-0', 'opacity-100');

}, 2200);

}

// Generic snippet copy

function copySnippet(snippetId, btnId) {

const el = document.getElementById(snippetId);

if (!el) return;

navigator.clipboard.writeText(el.textContent.trim());

showToast('Command copied: ' + el.textContent.trim());

}

function copyHash(hash) {

navigator.clipboard.writeText(hash);

showToast('SHA-256 Hash copied');

}

// Interactive Routing Graph Animation

function triggerStreamRoute(caller, worker, startY, endY, latency) {

const cable = document.getElementById('activePulseCable');

const hub = document.getElementById('hubCore');

const logContainer = document.getElementById('traceLogContainer');

const clock = document.getElementById('traceClock');

// Update path

const d = `M 120 ${startY} C 185 ${startY}, 185 94, 230 94 C 275 94, 275 ${endY}, 340 ${endY}`;

cable.setAttribute('d', d);

cable.classList.remove('opacity-0');

cable.classList.add('opacity-100');

hub.classList.add('scale-105', 'border-primary', 'shadow-glow-champagne');

const now = new Date();

const timeStr = now.toTimeString().split(' ')\[0\] + '.' + String(now.getMilliseconds()).slice(0, 2);

clock.textContent = timeStr;

const log = document.createElement('div');

log.className = 'truncate text-zinc-200';

log.innerHTML = `[${timeStr}] ROUTE <span class="text-primary font-semibold">${caller}</span> → <span class="text-emerald-400 font-semibold">${worker}</span> (${latency} · zero-copy)`;

logContainer.appendChild(log);

if (logContainer.children.length > 3) logContainer.removeChild(logContainer.children\[0\]);

setTimeout(() => {

cable.classList.remove('opacity-100');

cable.classList.add('opacity-0');

hub.classList.remove('scale-105', 'border-primary', 'shadow-glow-champagne');

}, 650);

}

function simulateBurst() {

const burstList = \[

{ c: '[client.py](http://client.py)', w: 'llama-3-8b', s: 34, e: 34, l: '0.14ms' },

{ c: 'web\_agent', w: 'deepseek-r1', s: 94, e: 94, l: '0.28ms' },

{ c: 'local\_eval', w: 'gemini-flash', s: 154, e: 154, l: '0.11ms' }

\];

burstList.forEach((item, idx) => {

setTimeout(() => {

triggerStreamRoute(item.c, item.w, item.s, item.e, item.l);

}, idx \* 220);

});

const rps = document.getElementById('liveRpsCount');

rps.textContent = '342 rps';

rps.classList.add('text-primary');

setTimeout(() => {

rps.textContent = '128 rps';

rps.classList.remove('text-primary');

}, 2000);

}

let standbyOn = true;

function toggleStandbyMode() {

standbyOn = !standbyOn;

document.getElementById('standbyLabel').textContent = standbyOn ? 'VRAM Standby: ON' : 'VRAM Standby: OFF';

showToast(standbyOn ? 'VRAM Standby mode activated' : 'VRAM Standby mode disabled');

}

// Architecture Tabs Logic

const archTabsData = {

posix: \`

<p class="mb-2"><strong class="text-white">Zero-Copy POSIX Shared Memory (SHM):</strong> Instead of streaming payloads over TCP loopback or copying through user/kernel boundaries, Lingonberry leverages <code class="text-primary">shm\_open</code> ring buffers.</p>

<p class="text-zinc-400">Callers map the memory descriptor directly into their virtual address space. Tokens stream without serialization serialization penalties, dropping transit latency from 8ms down to 0.18ms.</p>

\`,

ebpf: \`

<p class="mb-2"><strong class="text-white">Deterministic eBPF Isolation:</strong> Restricts agent process network access on the socket layer. Even if an agent runtime tries to egress private prompt context, the kernel filter blocks outbound sockets instantly.</p>

<p class="text-zinc-400">Certified for high-compliance air-gapped developer environments. All transactions are logged strictly to Unix domain pipes.</p>

\`,

vram: \`

<p class="mb-2"><strong class="text-white">Battery &amp; Task-Aware Metal Throttler:</strong> Lingonberry registers for macOS IOKit power events and Linux sysfs notifications.</p>

<p class="text-zinc-400">When system battery dips below 20% or high-priority compilation starts in the background, inactive Ollama / GGUF model weights are memory-mapped to NVMe swap seamlessly.</p>

\`

};

function switchArchTab(tab) {

\['posix', 'ebpf', 'vram'\].forEach(t => {

const btn = document.getElementById('archTab-' + t);

if (t === tab) {

btn.className = 'px-3 py-1 rounded-lg bg-white/\[0.08\] text-white text-\[11px\] font-mono font-medium';

} else {

btn.className = 'px-3 py-1 rounded-lg text-zinc-400 hover:text-white text-\[11px\] font-mono';

}

});

document.getElementById('archContent').innerHTML = archTabsData\[tab\];

}

// Modal Control Functions

function openTelemetryModal() {

document.getElementById('telemetryModal').classList.remove('hidden');

}

function closeTelemetryModal() {

document.getElementById('telemetryModal').classList.add('hidden');

}

function openArchModal() {

switchArchTab('posix');

document.getElementById('archModal').classList.remove('hidden');

}

function closeArchModal() {

document.getElementById('archModal').classList.add('hidden');

}

// Download Modal Logic

const osModalData = {

macos: {

title: "macOS Universal (.dmg)",

spec: "Apple Silicon (M1/M2/M3/M4) & Intel x86\_64",

install: "brew install lingonberry-router",

hash: "8a21fec998394e339b1a0d8bf7612c7d1e1fa42981ceefd12384a20b9e8310c4"

},

linux: {

title: "Linux systemd & Musl CLI",

spec: "Ubuntu / Debian (.deb), Arch (AUR), Fedora (.rpm)",

install: "curl -sSL [https://lingonberry.run/install.sh](https://lingonberry.run/install.sh) | bash",

hash: "310fb17e754a9d72210ea89bc44129e0019fa7648392100cfb88219488aef01c"

},

windows: {

title: "Windows 11 / 10 Installer (.msi)",

spec: "Named Pipes Daemon & Tray minimize support",

install: "winget install Lingonberry.Router",

hash: "714cfa882a9381a17fa3910cbe77291a1829e0129bc788210348719bc4a81729"

}

};

function setModalOs(os) {

\['macos', 'linux', 'windows'\].forEach(o => {

const btn = document.getElementById('mTab-' + o);

if (o === os) {

btn.className = 'flex-1 py-1.5 rounded-lg text-center font-mono text-\[11px\] font-semibold bg-white/\[0.1\] text-white';

} else {

btn.className = 'flex-1 py-1.5 rounded-lg text-center font-mono text-\[11px\] text-zinc-400 hover:text-white';

}

});

const d = osModalData\[os\];

document.getElementById('modalOsDetails').innerHTML = \`

<div class="flex items-center justify-between">

<div>

<div class="text-white text-\[13px\] font-semibold">${d.title}</div>

<div class="text-\[11px\] font-mono text-zinc-400">${d.spec}</div>

</div>

<a href="#" class="px-3 py-1.5 rounded-lg bg-primary hover:bg-amber-400 text-background font-semibold font-mono text-\[11px\] flex items-center gap-1 transition-colors">

<span class="material-symbols-outlined text-\[14px\]">download</span>

<span>Get Binary</span>

</a>

</div>

<div class="p-2 rounded-lg bg-black/60 border border-white/\[0.04\] flex items-center justify-between">

<span class="font-mono text-\[11px\] text-zinc-300">$ ${d.install}</span>

<button onclick="navigator.clipboard.writeText('${d.install}'); showToast('CLI command copied');" class="text-zinc-400 hover:text-white">

<span class="material-symbols-outlined text-\[13px\]">content\_copy</span>

</button>

</div>

<div class="text-\[10px\] font-mono text-zinc-400 flex items-center justify-between">

<span>SHA-256: ${d.hash.slice(0, 16)}...</span>

<button onclick="copyHash('${d.hash}')" class="text-primary hover:underline">Copy Checksum</button>

</div>

\`;

}

function openDownloadModal(os = 'macos') {

setModalOs(os);

document.getElementById('downloadModal').classList.remove('hidden');

}

function closeDownloadModal() {

document.getElementById('downloadModal').classList.add('hidden');

}

// Distribution Matrix Filter

function filterMatrix(platform) {

document.querySelectorAll('.matrix-filter-btn').forEach(btn => {

btn.classList.remove('bg-white/\[0.1\]', 'text-white');

btn.classList.add('text-zinc-400');

});

const activeBtn = document.getElementById('btn-filter-' + platform);

if (activeBtn) {

activeBtn.classList.add('bg-white/\[0.1\]', 'text-white');

activeBtn.classList.remove('text-zinc-400');

}

document.querySelectorAll('.matrix-row').forEach(row => {

if (platform === 'all' || row.dataset.platform === platform) {

[row.style](http://row.style).display = '';

} else {

[row.style](http://row.style).display = 'none';

}

});

}

// Keyboard Shortcuts (Cmd+K / Ctrl+K and Escape)

document.addEventListener('keydown', (e) => {

if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {

e.preventDefault();

openTelemetryModal();

}

if (e.key === 'Escape') {

closeTelemetryModal();

closeArchModal();

closeDownloadModal();

}

});

</script>

</body></html>