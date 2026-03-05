'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const params = JSON.parse(fs.readFileSync('/tmp/slide_params.json', 'utf8'));
const { audio_file, topic, voiceover, channel, output_mp4 } = params;

const WORK = '/tmp/slides_work';
if (!fs.existsSync(WORK)) fs.mkdirSync(WORK, { recursive: true });

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

async function main() {
  const slides = parseSlides(topic, voiceover);
  const clips = [];
  for (let i = 0; i < slides.length; i++) {
    const idx = String(i).padStart(3,'0');
    const png = `${WORK}/slide_${idx}.png`;
    const clip = `${WORK}/clip_${idx}.mp4`;
    await sharp(Buffer.from(slides[i].svg)).resize(1920,1080).png().toFile(png);
    execSync(`ffmpeg -loop 1 -i "${png}" -t ${slides[i].duration.toFixed(2)} -c:v libx264 -pix_fmt yuv420p -r 25 -y "${clip}"`, { timeout: 30000 });
    clips.push(clip);
    console.log(`Slide ${idx} OK`);
  }
  const concatTxt = `${WORK}/concat.txt`;
  fs.writeFileSync(concatTxt, clips.map(p => `file '${p}'`).join('\n'));
  const silent = `${WORK}/silent.mp4`;
  execSync(`ffmpeg -f concat -safe 0 -i "${concatTxt}" -c copy -y "${silent}"`, { timeout: 120000 });
  const outDir = path.dirname(output_mp4);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  execSync(`ffmpeg -i "${silent}" -i "${audio_file}" -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 -shortest -y "${output_mp4}"`, { timeout: 300000 });
  console.log('OUTPUT:' + output_mp4);
}

main().catch(e => { console.error(e.message); process.exit(1); });
