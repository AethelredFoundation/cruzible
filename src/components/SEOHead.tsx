import Head from 'next/head';

interface SEOHeadProps {
  title: string;
  description: string;
  path?: string;
}

/**
 * Consistent SEO head component for all AethelVault pages.
 * Generates title, OG tags, Twitter card, and canonical URL.
 */
export function SEOHead({ title, description, path = '' }: SEOHeadProps) {
  const fullTitle = `${title} | Cruzible`;
  const baseUrl = 'https://cruzible.aethelred.org';
  const ogImage = `${baseUrl}/og-image.svg`;

  return (
    <Head>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={`${baseUrl}${path}`} />

      {/* Open Graph */}
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="Cruzible" />
      <meta property="og:image" content={ogImage} />
      <meta property="og:url" content={`${baseUrl}${path}`} />

      {/* Twitter Card */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />
    </Head>
  );
}
