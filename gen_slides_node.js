'use strict';
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const params = JSON.parse(fs.readFileSync('/tmp/slide_params.json', 'utf8'));
const { audio_file, topic, voiceover, channel, output_mp4 } = params;

const WORK = '/tmp/slides_work';
if (fs.existsSync(WORK)) {
  fs.readdirSync(WORK).forEach(f => { try { fs.unlinkSync(WORK+'/'+f); } catch(e){} });
} else {
  fs.mkdirSync(WORK, { recursive: true });
}

// Try to install system ffmpeg via Alpine apk (works if container runs as root)
try {
  const r = spawnSync('apk', ['add', '--no-cache', 'ffmpeg'], { timeout: 90000, stdio: 'pipe', encoding: 'utf8' });
  if (r.status === 0) {
    console.log('apk: ffmpeg installed successfully');
  } else {
    console.log('apk: ffmpeg install failed (status ' + r.status + '), stderr:', (r.stderr||'').slice(0,200));
  }
} catch(e) {
  console.log('apk not available:', e.message.slice(0,100));
}

// Probe available ffmpeg binaries
function probeFfmpeg() {
  const candidates = [
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
    'ffmpeg',
  ];
  for (const bin of candidates) {
    try {
      const r = spawnSync(bin, ['-version'], { encoding: 'utf8', timeout: 8000, env: process.env });
      console.log(`${bin} exit:${r.status} stderr:${(r.stderr||'').slice(0,100)}`);
      if (r.status === 0) return bin;
    } catch(e) { /* skip */ }
  }
  return null;
}

const FFMPEG = probeFfmpeg();
console.log('usable ffmpeg:', FFMPEG);

// Install @ffmpeg/ffmpeg + @ffmpeg/core if system ffmpeg is broken
const FFWASM_DIR = '/tmp/ffwasm';
async function ensureWasmFfmpeg() {
  if (!fs.existsSync(FFWASM_DIR + '/node_modules/@ffmpeg/ffmpeg')) {
    console.log('Installing @ffmpeg/ffmpeg...');
    execSync(`npm install @ffmpeg/ffmpeg@0.12.6 @ffmpeg/core@0.12.4 --prefix ${FFWASM_DIR} --no-fund --no-audit`, { timeout: 300000 });
    console.log('@ffmpeg/ffmpeg installed');
  } else {
    console.log('@ffmpeg/ffmpeg already present');
  }
  // Verify core WASM exists
  const corePath = FFWASM_DIR + '/node_modules/@ffmpeg/core/dist/ffmpeg-core.js';
  if (!fs.existsSync(corePath)) {
    console.log('Core missing, reinstalling...');
    execSync(`npm install @ffmpeg/ffmpeg@0.12.6 @ffmpeg/core@0.12.4 --prefix ${FFWASM_DIR} --no-fund --no-audit`, { timeout: 300000 });
  }
  console.log('Core exists:', fs.existsSync(corePath));
}

const sharp = require('/tmp/nmods/node_modules/sharp');

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function wrapText(text, max) {
  const words = text.split(' ');
  const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (t.length > max) { if (cur) lines.push(cur); cur = w; } else { cur = t; }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}
function titleSvg(title, subtitle) {
  const lines = wrapText(title, 38);
  const lh = 110;
  const startY = (1080 - lines.length * lh) / 2 - 80;
  const els = lines.map((l, i) =>
    `<text x="960" y="${startY + i * lh + 90}" font-family="sans-serif" font-size="88" font-weight="bold" fill="white" text-anchor="middle">${esc(l)}</text>`
  ).join('\n');
  return `<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f0c29"/><stop offset="100%" stop-color="#302b63"/>
    </linearGradient></defs>
    <rect width="1920" height="1080" fill="url(#g)"/>
    <rect x="160" y="${startY + lines.length * lh + 110}" width="1600" height="7" fill="#e94560" rx="3"/>
    ${els}
    <text x="960" y="${startY + lines.length * lh + 185}" font-family="sans-serif" font-size="52" fill="#a8dadc" text-anchor="middle">${esc(subtitle)}</text>
  </svg>`;
}
function contentSvg(text, slideNum) {
  const lines = wrapText(text, 46);
  const lh = 90;
  const startY = (1080 - lines.length * lh) / 2;
  const els = lines.map((l, i) =>
    `<text x="960" y="${startY + i * lh}" font-family="sans-serif" font-size="70" fill="white" text-anchor="middle">${esc(l)}</text>`
  ).join('\n');
  const colors = ['#16213e','#1a1a2e','#0d1b2a','#1b2838','#162032','#0f1923'];
  const bg = colors[slideNum % colors.length];
  return `<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
    <rect width="1920" height="1080" fill="${bg}"/>
    <rect x="0" y="0" width="12" height="1080" fill="#e94560"/>
    <rect x="0" y="1000" width="1920" height="80" fill="#e94560" opacity="0.08"/>
    ${els}
  </svg>`;
}
function ctaSvg() {
  return `<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
    <rect width="1920" height="1080" fill="#0f3460"/>
    <rect x="360" y="380" width="1200" height="300" rx="24" fill="#e94560" opacity="0.12"/>
    <text x="960" y="500" font-family="sans-serif" font-size="100" font-weight="bold" fill="#e94560" text-anchor="middle">Like &amp; Subscribe!</text>
    <text x="960" y="620" font-family="sans-serif" font-size="54" fill="white" text-anchor="middle">More entrepreneur tips every week</text>
  </svg>`;
}
function parseSlides(topic, voiceover) {
  const slides = [];
  slides.push({ svg: titleSvg(topic, 'The complete guide'), duration: 6 });
  const sentences = voiceover.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 20);
  for (let i = 0; i < sentences.length; i += 2) {
    const text = [sentences[i], sentences[i+1]].filter(Boolean).join(' ');
    if (text.length < 15) continue;
    const wc = text.split(' ').length;
    slides.push({ svg: contentSvg(text, slides.length), duration: Math.min(Math.max(wc / 2.5, 4), 12) });
    if (slides.length >= 13) break;
  }
  slides.push({ svg: ctaSvg(), duration: 5 });
  return slides;
}

// Run ffmpeg via WASM in a child script — with explicit corePath for Node.js
async function encodeWithWasm(pngs, durations, audioFile, outputMp4) {
  const corePath = FFWASM_DIR + '/node_modules/@ffmpeg/core/dist/ffmpeg-core.js';
  const script = `
const { createFFmpeg, fetchFile } = require('${FFWASM_DIR}/node_modules/@ffmpeg/ffmpeg');
const fs = require('fs');

(async () => {
  console.log('Loading ffmpeg WASM with corePath...');
  const ffmpeg = createFFmpeg({
    log: true,
    corePath: 'file://${corePath}'
  });
  await ffmpeg.load();
  console.log('WASM loaded OK');

  // Write each PNG directly from disk
  const pngs = ${JSON.stringify(pngs)};
  const durations = ${JSON.stringify(durations)};
  for (let i = 0; i < pngs.length; i++) {
    const name = 'slide_' + String(i).padStart(3,'0') + '.png';
    ffmpeg.FS('writeFile', name, new Uint8Array(fs.readFileSync(pngs[i])));
  }

  // Write audio
  const audioExt = '${path.extname(audioFile)}';
  ffmpeg.FS('writeFile', 'audio' + audioExt, new Uint8Array(fs.readFileSync('${audioFile}')));

  // Encode each slide to a clip
  const clips = [];
  for (let i = 0; i < pngs.length; i++) {
    const clipName = 'clip_' + String(i).padStart(3,'0') + '.mp4';
    await ffmpeg.run('-loop', '1', '-i', 'slide_' + String(i).padStart(3,'0') + '.png',
      '-t', String(durations[i].toFixed(2)), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '25', '-y', clipName);
    clips.push(clipName);
    console.log('Encoded slide', i);
  }

  // Concat
  const concatList = clips.map(c => 'file ' + c).join('\\n');
  ffmpeg.FS('writeFile', 'concat.txt', new TextEncoder().encode(concatList));
  await ffmpeg.run('-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', '-y', 'silent.mp4');

  // Merge audio
  await ffmpeg.run('-i', 'silent.mp4', '-i', 'audio' + audioExt,
    '-c:v', 'copy', '-c:a', 'aac', '-map', '0:v:0', '-map', '1:a:0', '-shortest', '-y', 'output.mp4');

  // Save output
  const data = ffmpeg.FS('readFile', 'output.mp4');
  fs.writeFileSync('${outputMp4}', Buffer.from(data));
  console.log('DONE size:', data.byteLength);
})().catch(e => { console.error('WASM error:', e.message, e.stack ? e.stack.slice(0,500) : ''); process.exit(1); });
`;
  const scriptPath = '/tmp/wasm_encode.js';
  fs.writeFileSync(scriptPath, script);
  let out = '';
  try {
    out = execSync('node ' + scriptPath, { timeout: 3600000, encoding: 'utf8', stdio: 'pipe' });
    console.log('WASM output:', out.slice(0, 500));
  } catch(e) {
    const stderr = (e.stderr || '').slice(0, 2000);
    const stdout = (e.stdout || '').slice(0, 1000);
    throw new Error('wasm_encode failed|STDERR:' + stderr + '|STDOUT:' + stdout);
  }
}

async function main() {
  const slides = parseSlides(topic, voiceover);

  // Generate PNGs
  const pngs = [];
  const durations = [];
  for (let i = 0; i < slides.length; i++) {
    const idx = String(i).padStart(3,'0');
    const png = `${WORK}/slide_${idx}.png`;
    await sharp(Buffer.from(slides[i].svg)).resize(1920,1080).png().toFile(png);
    pngs.push(png);
    durations.push(slides[i].duration);
    console.log(`PNG ${idx}: ${fs.statSync(png).size} bytes`);
  }

  if (FFMPEG) {
    // System ffmpeg works — use it
    console.log('Using system ffmpeg:', FFMPEG);
    const clips = [];
    for (let i = 0; i < pngs.length; i++) {
      const idx = String(i).padStart(3,'0');
      const clip = `${WORK}/clip_${idx}.mp4`;
      const r = spawnSync(FFMPEG, ['-y','-loop','1','-i',pngs[i],'-t',durations[i].toFixed(2),
        '-c:v','libx264','-pix_fmt','yuv420p','-r','25', clip],
        { timeout: 60000, encoding: 'utf8' });
      if (!fs.existsSync(clip) || fs.statSync(clip).size < 100) {
        throw new Error(`ffmpeg clip failed for slide ${i}: ${(r.stderr||'').slice(0,300)}`);
      }
      clips.push(clip);
      console.log(`Slide ${idx} OK`);
    }
    const concatTxt = `${WORK}/concat.txt`;
    fs.writeFileSync(concatTxt, clips.map(p => `file '${p}'`).join('\n'));
    const silent = `${WORK}/silent.mp4`;
    spawnSync(FFMPEG, ['-f','concat','-safe','0','-i',concatTxt,'-c','copy','-y',silent], { timeout: 120000 });
    const outDir = path.dirname(output_mp4);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    spawnSync(FFMPEG, ['-i',silent,'-i',audio_file,'-c:v','copy','-c:a','aac',
      '-map','0:v:0','-map','1:a:0','-shortest','-y',output_mp4], { timeout: 300000 });
  } else {
    // System ffmpeg broken — use @ffmpeg/ffmpeg WASM
    console.log('System ffmpeg broken, using WASM...');
    await ensureWasmFfmpeg();
    const outDir = path.dirname(output_mp4);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    await encodeWithWasm(pngs, durations, audio_file, output_mp4);
  }

  if (!fs.existsSync(output_mp4) || fs.statSync(output_mp4).size < 1000) {
    throw new Error('Output MP4 not produced: ' + output_mp4);
  }
  console.log('OUTPUT:' + output_mp4 + ' size:' + fs.statSync(output_mp4).size);
}

main().catch(e => { console.error(e.message); process.exit(1); });
