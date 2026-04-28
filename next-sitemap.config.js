/** @type {import('next-sitemap').IConfig} */
const enableDevtools = process.env.NEXT_PUBLIC_ENABLE_DEVTOOLS === "true";

module.exports = {
  siteUrl: process.env.SITE_URL || "https://vault.aethelred.org",
  generateRobotsTxt: false,
  sitemapSize: 5000,
  exclude: enableDevtools ? [] : ["/devtools"],
};
