import Document, {
  Html,
  Head,
  Main,
  NextScript,
  type DocumentContext,
  type DocumentInitialProps,
} from "next/document";

type DocumentProps = DocumentInitialProps & {
  nonce?: string;
};

export default class CruzibleDocument extends Document<DocumentProps> {
  static async getInitialProps(ctx: DocumentContext): Promise<DocumentProps> {
    const initialProps = await Document.getInitialProps(ctx);
    const nonceHeader = ctx.req?.headers["x-nonce"];
    const nonce = Array.isArray(nonceHeader) ? nonceHeader[0] : nonceHeader;

    return {
      ...initialProps,
      nonce,
    };
  }

  render() {
    const { nonce } = this.props;

    return (
      <Html lang="en" className="dark">
        <Head nonce={nonce}>
          <meta charSet="utf-8" />
          <meta name="theme-color" content="#0f172a" />
          <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
          <link
            rel="apple-touch-icon"
            sizes="180x180"
            href="/apple-touch-icon.png"
          />
          <link rel="manifest" href="/site.webmanifest" />
        </Head>
        <body className="bg-slate-950 text-slate-200 antialiased">
          <Main />
          <NextScript nonce={nonce} />
        </body>
      </Html>
    );
  }
}
