import { MobileDocsBar } from "@vercel/geistdocs/mobile-docs-bar";
import { createDocsPage } from "@vercel/geistdocs/pages/docs";
import type { MDXComponents } from "mdx/types";
import { getMDXComponents } from "@/components/geistdocs/mdx-components";
import { config } from "@/lib/geistdocs/config";
import { geistdocsSource } from "@/lib/geistdocs/source";
import { getSiteOrigin } from "@/lib/geistdocs/url";

const docsPage = createDocsPage({
  config,
  mdx: ({ link }) => {
    const components: MDXComponents = link ? { a: link } : {};
    return getMDXComponents(components);
  },
  metadata: ({ metadata, page }) => {
    const image = geistdocsSource.getPageImage(page).url;

    return {
      ...metadata,
      metadataBase: new URL(getSiteOrigin()),
      openGraph: {
        ...metadata.openGraph,
        description: page.data.description,
        images: [image],
        title: page.data.title,
        url: page.url,
      },
      twitter: {
        card: "summary_large_image",
        description: page.data.description,
        images: [image],
        title: page.data.title,
      },
    };
  },
  source: geistdocsSource,
  tableOfContentPopover: {
    enabled: false,
  },
  renderTop: ({ data }) => <MobileDocsBar toc={data.toc} />,
});

export default docsPage.Page;
export const generateStaticParams = docsPage.generateStaticParams;
export const generateMetadata = docsPage.generateMetadata;
