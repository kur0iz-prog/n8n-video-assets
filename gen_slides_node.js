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

// Install @ffmpeg-installer/ffmpeg — statically linked, works on Alpine/musl
const FFNPM_DIR = '/tmp/ffnpm';
async function ensureNpmFfmpeg() {
  try {
    if (!fs.existsSync(FFNPM_DIR + '/node_modules/@ffmpeg-installer/ffmpeg')) {
      console.log('Installing @ffmpeg-installer/ffmpeg...');
      execSync(
        `npm install @ffmpeg-installer/ffmpeg --prefix ${FFNPM_DIR} --no-fund --no-audit`,
        { timeout: 180000, encoding: 'utf8' }
      );
      console.log('@ffmpeg-installer/ffmpeg installed');
    } else {
      console.log('@ffmpeg-installer/ffmpeg already present');
    }
    const installer = require(FFNPM_DIR + '/node_modules/@ffmpeg-installer/ffmpeg');
    const binPath = installer.path;
    console.log('@ffmpeg-installer path:', binPath);
    try { fs.chmodSync(binPath, 0o755); } catch(e) {}
    const r = spawnSync(binPath, ['-version'], { encoding: 'utf8', timeout: 10000 });
    console.log('@ffmpeg-installer probe exit:', r.status, (r.stderr||'').slice(0,120));
    if (r.status === 0) return binPath;
  } catch(e) {
    console.log('@ffmpeg-installer failed:', e.message.slice(0,200));
  }
  return null;
}

// Install @ffmpeg/ffmpeg + @ffmpeg/core if all else fails
const FFWASM_DIR = '/tmp/ffwasm';
async function ensureWasmFfmpeg() {
  if (!fs.existsSync(FFWASM_DIR + '/node_modules/@ffmpeg/ffmpeg')) {
    console.log('Installing @ffmpeg/ffmpeg...');
    execSync(`npm install @ffmpeg/ffmpeg@0.12.6 @ffmpeg/core@0.12.4 --prefix ${FFWASM_DIR} --no-fund --no-audit`, { timeout: 300000 });
    console.log('@ffmpeg/ffmpeg installed');
  } else {
    console.log('@ffmpeg/ffmpeg already present');
  }
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

// Encode using any available ffmpeg binary
function encodeWithBin(FFMPEG, pngs, durations, audioFile, outputMp4) {
  const clips = [];
  for (let i = 0; i < pngs.length; i++) {
    const idx = String(i).padStart(3,'0');
    const clip = `${WORK}/clip_${idx}.mp4`;
    const r = spawnSync(FFMPEG, ['-y','-loop','1','-i',pngs[i],'-t',durations[i].toFixed(2),
      '-c:v','libx264','-pix_fmt','yuv420p','-r','25', clip],
      { timeout: 60000, encoding: 'utf8' });
    if (!fs.existsSync(clip) || fs.statSync(clip).size < 100) {
      throw new Error(`ffmpeg clip failed for slide ${i}|${(r.stderr||'').slice(0,300)}`);
    }
    clips.push(clip);
    console.log(`Slide ${idx} OK`);
  }
  const concatTxt = `${WORK}/concat.txt`;
  fs.writeFileSync(concatTxt, clips.map(p => `file '${p}'`).join('\n'));
  const silent = `${WORK}/silent.mp4`;
  const rc = spawnSync(FFMPEG, ['-f','concat','-safe','0','-i',concatTxt,'-c','copy','-y',silent], { timeout: 120000 });
  if (!fs.existsSync(silent) || fs.statSync(silent).size < 100) {
    throw new Error(`concat failed|${(rc.stderr||'').slice(0,300)}`);
  }
  const outDir = path.dirname(outputMp4);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const rm = spawnSync(FFMPEG, ['-i',silent,'-i',audioFile,'-c:v','copy','-c:a','aac',
    '-map','0:v:0','-map','1:a:0','-shortest','-y',outputMp4], { timeout: 300000 });
  if (!fs.existsSync(outputMp4) || fs.statSync(outputMp4).size < 1000) {
    throw new Error(`audio merge failed|${(rm.stderr||'').slice(0,300)}`);
  }
}

// Run ffmpeg via WASM in a child script (last resort)
async function encodeWithWasm(pngs, durations, audioFile, outputMp4) {
  const corePath = FFWASM_DIR + '/node_modules/@ffmpeg/core/dist/ffmpeg-core.js';
  // Serve core via tiny http to avoid file:// URL issues in Node.js fetch
  const script = `
const { createFFmpeg } = require('${FFWASM_DIR}/node_modules/@ffmpeg/ffmpeg');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Serve WASM files locally so fetch() can load them
const coreDir = path.dirname('${corePath}');
const server = http.createServer((req, res) => {
  const fp = coreDir + req.url.split('?')[0];
  if (fs.existsSync(fp)) {
    const ct = fp.endsWith('.wasm') ? 'application/wasm' : 'application/javascript';
    res.writeHead(200, {'Content-Type': ct});
    fs.createReadStream(fp).pipe(res);
  } else { res.writeHead(404); res.end(); }
});
server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  console.log('WASM server on port', port);
  try {
    const ffmpeg = createFFmpeg({
      log: true,
      corePath: 'http://127.0.0.1:' + port + '/ffmpeg-core.js'
    });
    await ffmpeg.load();
    console.log('WASM loaded OK');

    const pngs = ${JSON.stringify(pngs)};
    const durations = ${JSON.stringify(durations)};
    for (let i = 0; i < pngs.length; i++) {
      const name = 'slide_' + String(i).padStart(3,'0') + '.png';
      ffmpeg.FS('writeFile', name, new Uint8Array(fs.readFileSync(pngs[i])));
    }
    const audioExt = '${path.extname(audioFile)}';
    ffmpeg.FS('writeFile', 'audio' + audioExt, new Uint8Array(fs.readFileSync('${audioFile}')));

    const clips = [];
    for (let i = 0; i < pngs.length; i++) {
      const clipName = 'clip_' + String(i).padStart(3,'0') + '.mp4';
      await ffmpeg.run('-loop','1','-i','slide_'+String(i).padStart(3,'0')+'.png',
        '-t',String(durations[i].toFixed(2)),'-c:v','libx264','-pix_fmt','yuv420p','-r','25','-y',clipName);
      clips.push(clipName);
    }
    const concatList = clips.map(c => 'file ' + c).join('\\n');
    ffmpeg.FS('writeFile', 'concat.txt', new TextEncoder().encode(concatList));
    await ffmpeg.run('-f','concat','-safe','0','-i','concat.txt','-c','copy','-y','silent.mp4');
    await ffmpeg.run('-i','silent.mp4','-i','audio'+audioExt,
      '-c:v','copy','-c:a','aac','-map','0:v:0','-map','1:a:0','-shortest','-y','output.mp4');
    const data = ffmpeg.FS('readFile','output.mp4');
    fs.writeFileSync('${outputMp4}', Buffer.from(data));
    console.log('DONE size:', data.byteLength);
  } catch(e) {
    console.error('WASM error:', e.message);
    process.exit(1);
  } finally { server.close(); }
});
`;
  const scriptPath = '/tmp/wasm_encode.js';
  fs.writeFileSync(scriptPath, script);
  try {
    const out = execSync('node ' + scriptPath, { timeout: 3600000, encoding: 'utf8', stdio: 'pipe' });
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

  // Try ffmpeg sources in order: system → npm static binary → WASM
  let ffmpegBin = probeFfmpeg();
  console.log('System ffmpeg probe:', ffmpegBin);

  if (!ffmpegBin) {
    console.log('System ffmpeg not usable, trying @ffmpeg-installer/ffmpeg...');
    ffmpegBin = await ensureNpmFfmpeg();
  }

  if (ffmpegBin) {
    console.log('Encoding with binary:', ffmpegBin);
    const outDir = path.dirname(output_mp4);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    encodeWithBin(ffmpegBin, pngs, durations, audio_file, output_mp4);
  } else {
    console.log('All binary ffmpeg options failed, using WASM...');
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
