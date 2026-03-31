/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: process.env.SITE_URL || "https://vault.aethelred.org",
  generateRobotsTxt: false,
  sitemapSize: 5000,
};
