#!/usr/bin/env python3
"""
Slide generator for YouTube video pipeline.
Creates 1920x1080 styled slides from a voiceover script + composites with audio using ffmpeg.
"""

import sys
import os
import json
import textwrap
import subprocess
import re

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    subprocess.run([sys.executable, '-m', 'pip', 'install', 'Pillow', '-q'])
    from PIL import Image, ImageDraw, ImageFont

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
W, H = 1920, 1080
SLIDE_DIR = '/tmp/slides'
os.makedirs(SLIDE_DIR, exist_ok=True)

# Colours
BG_DARK    = (10, 10, 20)
BG_SECTION = (15, 15, 35)
ACCENT     = (255, 107, 53)    # orange
ACCENT2    = (255, 215, 0)     # gold
WHITE      = (255, 255, 255)
GREY       = (180, 180, 180)
DARK_GREY  = (80, 80, 100)

def find_font(size, bold=False):
    """Find a usable font on the system."""
    candidates = [
        f'/usr/share/fonts/truetype/dejavu/DejaVuSans{"Bold" if bold else ""}.ttf',
        f'/usr/share/fonts/truetype/liberation/LiberationSans-{"Bold" if bold else "Regular"}.ttf',
        f'/usr/share/fonts/truetype/ubuntu/Ubuntu-{"B" if bold else "R"}.ttf',
        '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
    ]
    for p in candidates:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def draw_gradient_bg(draw, w, h, top_color, bot_color):
    """Draw a vertical gradient background."""
    for y in range(h):
        t = y / h
        r = int(top_color[0] + (bot_color[0] - top_color[0]) * t)
        g = int(top_color[1] + (bot_color[1] - top_color[1]) * t)
        b = int(top_color[2] + (bot_color[2] - top_color[2]) * t)
        draw.line([(0, y), (w, y)], fill=(r, g, b))

def draw_accent_bar(draw, y, w, color=ACCENT, height=6):
    draw.rectangle([0, y, w, y + height], fill=color)

def wrap_text(text, font, max_width, draw):
    """Wrap text to fit within max_width pixels."""
    words = text.split()
    lines = []
    current = []
    for word in words:
        test = ' '.join(current + [word])
        bbox = draw.textbbox((0, 0), test, font=font)
        if bbox[2] > max_width and current:
            lines.append(' '.join(current))
            current = [word]
        else:
            current.append(word)
    if current:
        lines.append(' '.join(current))
    return lines

def draw_centered_text(draw, text, font, y, color, max_width, line_spacing=1.3):
    """Draw centered, wrapped text starting at y. Returns final y."""
    lines = wrap_text(text, font, max_width, draw)
    bbox = draw.textbbox((0, 0), 'Ag', font=font)
    line_h = int((bbox[3] - bbox[1]) * line_spacing)
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        lw = bbox[2] - bbox[0]
        draw.text(((W - lw) // 2, y), line, font=font, fill=color)
        y += line_h
    return y

def make_title_slide(title, subtitle, channel, output_path):
    img = Image.new('RGB', (W, H))
    draw = ImageDraw.Draw(img)
    draw_gradient_bg(draw, W, H, (5, 5, 20), (20, 10, 40))
    draw_accent_bar(draw, 0, W, ACCENT, 8)
    draw.rectangle([60, 120, 68, H - 120], fill=(255, 107, 53, 80))
    draw.rectangle([W - 68, 120, W - 60, H - 120], fill=(255, 107, 53, 80))
    font_badge = find_font(28)
    badge_text = f'  {channel}  '
    bbox = draw.textbbox((0, 0), badge_text, font=font_badge)
    bw = bbox[2] - bbox[0] + 40
    bx = (W - bw) // 2
    draw.rounded_rectangle([bx, 160, bx + bw, 210], radius=20, fill=ACCENT)
    draw.text((bx + 20, 168), channel.upper(), font=font_badge, fill=WHITE)
    font_title = find_font(96, bold=True)
    y = 260
    y = draw_centered_text(draw, title, font_title, y, WHITE, W - 240, 1.2)
    y += 40
    draw.rectangle([(W // 2 - 120), y, (W // 2 + 120), y + 4], fill=ACCENT2)
    y += 30
    font_sub = find_font(42)
    draw_centered_text(draw, subtitle, font_sub, y + 20, GREY, W - 400)
    draw_accent_bar(draw, H - 8, W, ACCENT2, 8)
    img.save(output_path, quality=95)

def make_hook_slide(hook_text, output_path):
    img = Image.new('RGB', (W, H))
    draw = ImageDraw.Draw(img)
    draw_gradient_bg(draw, W, H, (18, 5, 5), (35, 10, 10))
    draw_accent_bar(draw, 0, W, ACCENT, 8)
    font_quote = find_font(220, bold=True)
    draw.text((80, -30), '"', font=font_quote, fill=(255, 107, 53, 40))
    font_label = find_font(32)
    label = 'THE HOOK'
    bbox = draw.textbbox((0, 0), label, font=font_label)
    lw = bbox[2] - bbox[0]
    draw.text(((W - lw) // 2, 180), label, font=font_label, fill=ACCENT)
    draw.rectangle([(W // 2 - 60), 225, (W // 2 + 60), 229], fill=ACCENT)
    font_hook = find_font(64, bold=True)
    draw_centered_text(draw, hook_text, font_hook, 280, WHITE, W - 300, 1.25)
    draw_accent_bar(draw, H - 8, W, ACCENT, 8)
    img.save(output_path, quality=95)

def make_section_slide(section_num, total_sections, section_title, body_text, output_path):
    img = Image.new('RGB', (W, H))
    draw = ImageDraw.Draw(img)
    draw_gradient_bg(draw, W, H, BG_DARK, (15, 15, 35))
    draw_accent_bar(draw, 0, W, ACCENT, 8)
    bubble_x, bubble_y = 140, 130
    draw.ellipse([bubble_x - 70, bubble_y - 70, bubble_x + 70, bubble_y + 70], fill=ACCENT)
    font_num = find_font(72, bold=True)
    num_str = str(section_num)
    bbox = draw.textbbox((0, 0), num_str, font=font_num)
    nw, nh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text((bubble_x - nw // 2, bubble_y - nh // 2 - 5), num_str, font=font_num, fill=WHITE)
    dot_x = 250
    for i in range(total_sections):
        color = ACCENT if i < section_num else DARK_GREY
        draw.ellipse([dot_x + i * 35, 120, dot_x + i * 35 + 18, 138], fill=color)
    if ':' in section_title:
        parts = section_title.split(':', 1)
        label_part = parts[0].strip()
        title_part = parts[1].strip()
    else:
        label_part = f'Day {section_num}'
        title_part = section_title
    font_label_sm = find_font(38)
    label_y = 235
    label_bbox = draw.textbbox((0, 0), label_part.upper(), font=font_label_sm)
    lw = label_bbox[2] - label_bbox[0]
    draw.text(((W - lw) // 2, label_y), label_part.upper(), font=font_label_sm, fill=ACCENT)
    label_y += 55
    font_title = find_font(68, bold=True)
    title_y = label_y
    title_y = draw_centered_text(draw, title_part, font_title, title_y, WHITE, W - 200, 1.2)
    title_y += 20
    draw.rectangle([(W // 2 - 150), title_y, (W // 2 + 150), title_y + 4], fill=ACCENT2)
    title_y += 35
    font_body = find_font(44)
    draw_centered_text(draw, body_text, font_body, title_y, GREY, W - 280, 1.35)
    draw_accent_bar(draw, H - 8, W, ACCENT2, 8)
    img.save(output_path, quality=95)

def make_cta_slide(channel, output_path):
    img = Image.new('RGB', (W, H))
    draw = ImageDraw.Draw(img)
    draw_gradient_bg(draw, W, H, (5, 5, 30), (20, 20, 60))
    draw_accent_bar(draw, 0, W, ACCENT, 8)
    cx, cy = W // 2, 200
    draw.ellipse([cx - 55, cy - 80, cx + 55, cy + 30], outline=ACCENT2, width=6)
    draw.rectangle([cx - 55, cy - 10, cx + 55, cy + 30], fill=BG_DARK)
    draw.ellipse([cx - 55, cy - 10, cx + 55, cy + 50], outline=ACCENT2, width=6)
    draw.rectangle([cx - 8, cy + 45, cx + 8, cy + 65], fill=ACCENT2)
    font_cta = find_font(80, bold=True)
    y = 310
    y = draw_centered_text(draw, 'Found this valuable?', font_cta, y, WHITE, W - 200, 1.2)
    y += 30
    font_sub = find_font(52)
    y = draw_centered_text(draw, f'Subscribe to {channel}', font_sub, y, ACCENT2, W - 200, 1.25)
    y += 20
    draw_centered_text(draw, 'for weekly founder insights and startup strategies', font_sub, y, GREY, W - 240, 1.25)
    draw_accent_bar(draw, H - 8, W, ACCENT, 8)
    img.save(output_path, quality=95)

def parse_script_to_slides(topic, voiceover_text, channel='Entrepreneurship & Founder Mindset'):
    slides = []
    slides.append({'type': 'title', 'title': topic, 'subtitle': 'A Step-by-Step Founder Framework', 'channel': channel, 'duration_ratio': 0.06})
    lines = voiceover_text.strip().split('\n')
    non_empty = [l.strip() for l in lines if l.strip()]
    hook_lines = []
    in_hook = True
    for line in non_empty:
        low = line.lower()
        if re.search(r'\bday\s+[1-7]\b|\bstep\s+[1-9]\b|\b(conclusion|cta|call to action|subscribe)\b', low):
            in_hook = False
        if in_hook:
            hook_lines.append(line)
    hook_text = ' '.join(hook_lines[:3])[:300] or "Most entrepreneurs waste months building the wrong product. Here's how to validate your idea in just 7 days."
    slides.append({'type': 'hook', 'text': hook_text, 'duration_ratio': 0.09})
    day_pattern = re.compile(r'(?:day\s+(\d+)(?:[–\-]\s*\d+)?|step\s+(\d+))', re.IGNORECASE)
    segments = re.split(r'(?=\b(?:Day|Step)\s+\d)', voiceover_text, flags=re.IGNORECASE)
    day_segments = []
    for seg in segments:
        seg = seg.strip()
        if not seg:
            continue
        m = day_pattern.match(seg)
        if m:
            day_num = int(m.group(1) or m.group(2))
            rest = seg[m.end():].strip().lstrip(':-–').strip()
            first_sentence = re.split(r'[.!?\n]', rest)[0].strip()[:120] or rest[:120]
            body = ' '.join(rest.replace('\n', ' ').split()[:40])
            day_segments.append((day_num, f'Day {day_num}', first_sentence, body))
    if not day_segments:
        placeholders = [
            (1, 'Day 1-2: Define the Problem', 'Interview 5 potential customers about their biggest frustrations.', 'Start with the problem, not your solution.'),
            (2, 'Day 3: Map the Competition', 'Research existing solutions and find your unique angle.', 'Your unique angle lives in the gaps competitors leave.'),
            (3, 'Day 4-5: Build a Smoke Test', 'Create a landing page to test demand before building.', 'A simple headline and signup form is enough to start.'),
            (4, 'Day 6: Measure Real Signal', 'Track signups, clicks, or pre-orders to validate interest.', 'A 10% conversion rate means you have something real.'),
            (5, 'Day 7: Go / No-Go Decision', 'Use data, not gut feeling, to decide whether to proceed.', 'You just saved yourself 6 months and thousands of dollars.'),
        ]
        day_segments = placeholders
    n_sections = len(day_segments)
    section_ratio = 0.72 / max(n_sections, 1)
    for i, item in enumerate(day_segments):
        day_num, section_title, first_sentence, body = item
        if ':' in section_title:
            day_label, raw_title = section_title.split(':', 1)
            raw_title = raw_title.strip()
        else:
            day_label = f'Day {day_num}'
            raw_title = first_sentence
        if len(raw_title) > 42:
            raw_title = raw_title[:42].rsplit(' ', 1)[0].rstrip(',;:')
        clean_title = f'{day_label.strip()}: {raw_title}'
        clean_body = body if body else first_sentence
        slides.append({'type': 'section', 'section_num': i + 1, 'total': n_sections, 'title': clean_title, 'body': clean_body, 'duration_ratio': section_ratio})
    slides.append({'type': 'cta', 'channel': channel, 'duration_ratio': 0.08})
    return slides

def generate_video(audio_mp4, topic, voiceover, channel, output_mp4):
    dur_cmd = f'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "{audio_mp4}"'
    result = subprocess.run(dur_cmd, shell=True, capture_output=True, text=True)
    total_duration = float(result.stdout.strip() or '320')
    print(f'Audio duration: {total_duration:.1f}s')
    slides_data = parse_script_to_slides(topic, voiceover, channel)
    print(f'Generated {len(slides_data)} slides')
    img_paths = []
    durations = []
    for i, slide in enumerate(slides_data):
        out_path = f'{SLIDE_DIR}/slide_{i:03d}.png'
        stype = slide['type']
        if stype == 'title':
            make_title_slide(slide['title'], slide['subtitle'], slide['channel'], out_path)
        elif stype == 'hook':
            make_hook_slide(slide['text'], out_path)
        elif stype == 'section':
            make_section_slide(slide['section_num'], slide['total'], slide['title'], slide['body'], out_path)
        elif stype == 'cta':
            make_cta_slide(slide['channel'], out_path)
        dur = slide['duration_ratio'] * total_duration
        img_paths.append(out_path)
        durations.append(dur)
        print(f'  Slide {i+1}: {stype} ({dur:.1f}s) -> {out_path}')
    total_slide_dur = sum(durations)
    scale = total_duration / total_slide_dur
    durations = [d * scale for d in durations]
    concat_file = '/tmp/slides_concat.txt'
    with open(concat_file, 'w') as f:
        for path, dur in zip(img_paths, durations):
            f.write(f"file '{path}'\n")
            f.write(f"duration {dur:.3f}\n")
        f.write(f"file '{img_paths[-1]}'\n")
    print(f'Concat file written: {concat_file}')
    slides_video = '/tmp/slides_video.mp4'
    ffmpeg_slides = (
        f'ffmpeg -y -f concat -safe 0 -i "{concat_file}" '
        f'-vf "scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2" '
        f'-c:v libx264 -preset fast -crf 20 -r 25 -pix_fmt yuv420p '
        f'"{slides_video}"'
    )
    print('Building slides video...')
    r = subprocess.run(ffmpeg_slides, shell=True, capture_output=True, text=True, timeout=180)
    if r.returncode != 0:
        print('FFMPEG slides error:', r.stderr[-2000:])
        raise RuntimeError('ffmpeg slides failed')
    print('Slides video built.')
    ffmpeg_merge = (
        f'ffmpeg -y -i "{slides_video}" -i "{audio_mp4}" '
        f'-map 0:v:0 -map 1:a:0 '
        f'-c:v copy -c:a aac -b:a 192k -shortest '
        f'"{output_mp4}"'
    )
    print('Merging video + audio...')
    r = subprocess.run(ffmpeg_merge, shell=True, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        print('FFMPEG merge error:', r.stderr[-2000:])
        raise RuntimeError('ffmpeg merge failed')
    print(f'Final video: {output_mp4}')
    return output_mp4

DEFAULT_VOICEOVER = """
Here's the brutal truth about startup failure: 90% of founders spend months building something nobody wants.
The solution is not working harder, it's validating smarter. Here's how to do it in 7 days.

Day 1-2: Define the Customer Problem
Don't start with your solution. Start with the problem. Interview at least 5 potential customers.
Ask them about their biggest frustrations, not about your idea. Listen more than you talk.

Day 3: Research the Competition
Map every existing solution. Where are the gaps? What do customers complain about?
Your unique angle lives in those gaps.

Day 4-5: Build a Smoke Test
Create a simple landing page that describes your solution. No code needed, just a headline,
three bullet points, and a signup form. Drive 50 to 100 relevant people to it.

Day 6: Measure Real Signal
Count signups, not compliments. A 10% conversion rate means you have something real.
Below 3%? Pivot or kill the idea.

Day 7: Make the Go/No-Go Decision
Review your data with brutal honesty. If the signal is strong, move to an MVP.
If it isn't, you just saved yourself 6 months and thousands of dollars. That's a win.

The entrepreneurs who succeed aren't the ones with the best ideas, they're the ones who validate fastest.
Subscribe for more frameworks like this, every week.
"""

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--params', default='', help='Path to JSON params file')
    parser.add_argument('--audio', default='')
    parser.add_argument('--topic', default='How to Validate a Business Idea in 7 Days')
    parser.add_argument('--voiceover', default='')
    parser.add_argument('--channel', default='Entrepreneurship & Founder Mindset')
    parser.add_argument('--output', default='/tmp/final_video.mp4')
    args = parser.parse_args()
    if args.params and os.path.exists(args.params):
        with open(args.params) as f:
            params = json.load(f)
        audio_file = params['audio_file']
        topic = params.get('topic', 'Business Idea')
        voiceover = params.get('voiceover', DEFAULT_VOICEOVER)
        channel = params.get('channel', 'Entrepreneurship & Founder Mindset')
        output_mp4 = params['output_mp4']
    else:
        audio_file = args.audio
        topic = args.topic
        voiceover = args.voiceover or DEFAULT_VOICEOVER
        channel = args.channel
        output_mp4 = args.output
    generate_video(audio_file, topic, voiceover, channel, output_mp4)
