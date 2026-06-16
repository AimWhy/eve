import { GeistdocsDocsLayout as PackageDocsLayout } from "@vercel/geistdocs/layout";
import type { ComponentProps, ReactNode } from "react";
import { config } from "@/lib/geistdocs/config";

interface DocsLayoutProps {
  children: ReactNode;
  tree: ComponentProps<typeof PackageDocsLayout>["tree"];
}

export const DocsLayout = ({ tree, children }: DocsLayoutProps) => (
  <PackageDocsLayout
    config={config}
    containerProps={{
      className: "bg-background-100 max-w-[1448px] mx-auto",
    }}
    tree={tree}
  >
    <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-gray-900 text-sm">
      <span className="font-medium text-amber-800">Public Beta:</span> Eve is subject to the{" "}
      <a
        className="font-medium underline underline-offset-2"
        href="https://vercel.com/docs/release-phases/public-beta-agreement"
      >
        Vercel public beta agreement
      </a>
      , and framework behavior may change before general availability.
    </div>
    {children}
  </PackageDocsLayout>
);
