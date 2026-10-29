"""
Generate LifeLink PWA Application Icons.
Creates genuine, high-fidelity brand icons in required sizes for Android Chrome and iOS Safari:
- icon-192.png (192x192)
- icon-512.png (512x512)
- icon-maskable-512.png (512x512 with safe-zone margin)
- apple-touch-icon.png (180x180)
"""

from PIL import Image, ImageDraw, ImageFilter
import math
import os

def create_lifelink_icon(size: int, is_maskable: bool = False) -> Image.Image:
    # 4x super-sampling for pristine antialiasing
    scale = 4
    canvas_size = size * scale
    img = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    center = canvas_size / 2

    if is_maskable:
        # Maskable icons need 100% background fill with content within the 80% safe zone
        # Background: deep slate-950
        draw.rectangle([0, 0, canvas_size, canvas_size], fill=(15, 23, 42, 255))
        content_radius = (canvas_size * 0.72) / 2
    else:
        # Standard icon: rounded squircle / circular badge
        bg_radius = canvas_size * 0.46
        # Background gradient or solid deep slate
        draw.ellipse(
            [center - bg_radius, center - bg_radius, center + bg_radius, center + bg_radius],
            fill=(15, 23, 42, 255),
            outline=(225, 29, 72, 80),
            width=int(4 * scale)
        )
        content_radius = bg_radius * 0.78

    # Draw Emergency Health Cross + Lightning Bolt Emblem
    # Central cross dimensions
    cross_w = content_radius * 0.32
    cross_h = content_radius * 0.95

    # Glowing outer ring
    glow_radius = content_radius * 1.05
    for r in range(int(glow_radius), int(content_radius * 0.92), -1):
        alpha = int(40 * (glow_radius - r) / (glow_radius - content_radius * 0.92))
        draw.ellipse([center - r, center - r, center + r, center + r], outline=(225, 29, 72, alpha), width=int(2 * scale))

    # Medical Cross in Rose-600 with rounded corners
    cross_color = (225, 29, 72, 255) # #e11d48 LifeLink Emergency Rose
    corner_r = int(cross_w * 0.35)

    # Vertical bar of cross
    draw.rounded_rectangle(
        [center - cross_w / 2, center - cross_h / 2, center + cross_w / 2, center + cross_h / 2],
        radius=corner_r,
        fill=cross_color
    )
    # Horizontal bar of cross
    draw.rounded_rectangle(
        [center - cross_h / 2, center - cross_w / 2, center + cross_h / 2, center + cross_w / 2],
        radius=corner_r,
        fill=cross_color
    )

    # Superimposed dynamic Heartbeat / Lightning Pulse in White (#ffffff)
    pulse_w = int(cross_w * 0.38)
    pulse_pts = [
        (center - cross_h * 0.36, center),
        (center - cross_h * 0.16, center),
        (center - cross_h * 0.08, center - cross_h * 0.28), # peak up
        (center + cross_h * 0.04, center + cross_h * 0.28), # valley down
        (center + cross_h * 0.12, center - cross_h * 0.12), # recovery peak
        (center + cross_h * 0.20, center),
        (center + cross_h * 0.36, center)
    ]

    for i in range(len(pulse_pts) - 1):
        draw.line([pulse_pts[i], pulse_pts[i+1]], fill=(255, 255, 255, 255), width=pulse_w, joint="curve")

    # Pulse connector caps
    for pt in pulse_pts:
        r = pulse_w / 2
        draw.ellipse([pt[0] - r, pt[1] - r, pt[0] + r, pt[1] + r], fill=(255, 255, 255, 255))

    # Downscale using LANCZOS filter for smooth, professional rendering
    final_img = img.resize((size, size), Image.Resampling.LANCZOS)
    return final_img

def main():
    public_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend/public"))
    os.makedirs(public_dir, exist_ok=True)

    icons = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-512.png", 512, True),
        ("apple-touch-icon.png", 180, False),
    ]

    for filename, size, maskable in icons:
        out_path = os.path.join(public_dir, filename)
        icon_img = create_lifelink_icon(size, is_maskable=maskable)
        icon_img.save(out_path, "PNG", optimize=True)
        print(f"Generated {filename} ({size}x{size}, maskable={maskable}) -> {out_path}")

if __name__ == "__main__":
    main()
