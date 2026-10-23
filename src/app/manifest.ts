import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RGXM Staffing",
    short_name: "RGXM",
    description: "Your RGXM shifts, briefs, hours and pay.",
    start_url: "/portal",
    scope: "/",
    display: "standalone",
    background_color: "#fbfbf9",
    theme_color: "#fbfbf9",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
