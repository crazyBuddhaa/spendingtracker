import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { ImportResult } from "../types.ts";
import { parsePdfPages, type PositionedPdfTextItem } from "./pdfText.ts";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function parsePdfStatement(data: ArrayBuffer, fileName: string): Promise<ImportResult> {
  const document = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const pages: PositionedPdfTextItem[][] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(
      content.items.flatMap((item) =>
        "str" in item && "transform" in item
          ? [{ str: item.str, transform: item.transform }]
          : [],
      ),
    );
  }

  return parsePdfPages(pages, fileName);
}
