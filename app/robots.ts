import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/host/", "/join/", "/play/"],
    },
    sitemap: "https://roomful.vercel.app/sitemap.xml",
  };
}
