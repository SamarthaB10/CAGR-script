import { handler as netlifyAnalyzeHandler } from "../netlify/functions/analyze.mjs";

export default async function analyze(req, res) {
  const bodyBuffer = await readRequestBody(req);
  const response = await netlifyAnalyzeHandler({
    httpMethod: req.method,
    headers: req.headers,
    body: bodyBuffer.toString("base64"),
    isBase64Encoded: true,
  });

  for (const [header, value] of Object.entries(response.headers || {})) {
    res.setHeader(header, value);
  }

  res.statusCode = response.statusCode;
  res.end(response.body || "");
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
