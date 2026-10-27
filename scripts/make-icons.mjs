// Generates PWA icons from an inline SVG. Re-run after branding changes: node scripts/make-icons.mjs
import sharp from "sharp";

const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <rect width="512" height="512" fill="#18181b"/>
  <text x="${pad ? 240 : 236}" y="${pad ? 288 : 294}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700"
        font-size="${pad ? 84 : 104}" letter-spacing="4" fill="#ffffff">RGXM</text>
  <circle cx="${pad ? 378 : 412}" cy="${pad ? 278 : 282}" r="${pad ? 9 : 11}" fill="#E4572E"/>
</svg>`;

await sharp(Buffer.from(svg(false))).resize(192).png().toFile("public/icons/icon-192.png");
await sharp(Buffer.from(svg(false))).png().toFile("public/icons/icon-512.png");
await sharp(Buffer.from(svg(true))).png().toFile("public/icons/icon-maskable-512.png");
await sharp(Buffer.from(svg(false))).resize(180).png().toFile("public/icons/apple-touch-icon.png");
console.log("icons written");
