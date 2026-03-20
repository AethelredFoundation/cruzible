/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: process.env.SITE_URL || "https://explorer.aethelred.io",
  generateRobotsTxt: true,
  generateIndexSitemap: false,
  outDir: "./public",
};
